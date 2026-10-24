import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialPlatform } from '@prisma/client';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { SocialAccountService } from '@modules/creators/creators.public';
import { CreatorCredentials } from '../domain/platform-metrics-adapter';
import { FetchFn, HTTP_FETCH } from '../infrastructure/fetch-json';
import {
  ConnectedAccount,
  OAuthAppCredentials,
  PlatformOAuth,
  PlatformTokens,
} from '../infrastructure/platform-oauth';
import { TokenVault } from './token-vault';

const STATE_TTL_MS = 10 * 60 * 1_000;
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1_000;

/** Which client started the flow decides where the callback page sends the code. */
export type ConnectionClient = 'web' | 'app';

export interface ConnectedPlatformAccount extends ConnectedAccount {
  platform: SocialPlatform;
}

interface OAuthState {
  userId: string;
  platform: SocialPlatform;
  client: ConnectionClient;
  expiresAt: number;
}

/**
 * Connects a creator's Instagram, TikTok, YouTube or Snapchat account so their posts' metrics can be
 * read, and hands adapters a usable (refreshed, decrypted) token. Tokens are stored
 * encrypted; the OAuth `state` is signed and expires, binding the callback to the
 * creator who started it.
 */
@Injectable()
export class PlatformConnectionService {
  private readonly vault: TokenVault;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(HTTP_FETCH) private readonly fetchFn: FetchFn,
    @Inject('PLATFORM_OAUTH_PROVIDERS') private readonly providers: PlatformOAuth[],
    private readonly socialAccounts: SocialAccountService,
  ) {
    this.vault = new TokenVault(this.config.get('SOCIAL_TOKEN_ENCRYPTION_KEY', { infer: true }));
  }

  startConnection(
    platform: SocialPlatform,
    userId: string,
    client: ConnectionClient,
  ): { authorizationUrl: string } {
    const provider = this.providerFor(platform);
    const app = this.appCredentials(platform);
    const state = this.vault.sign(
      Buffer.from(
        JSON.stringify({
          userId,
          platform,
          client,
          expiresAt: Date.now() + STATE_TTL_MS,
        } satisfies OAuthState),
      ).toString('base64url'),
    );
    return { authorizationUrl: provider.authorizationUrl(app, state) };
  }

  /** Exchanges the code, stores the creator's tokens and reports who connected. */
  async completeConnection(
    userId: string,
    code: string,
    state: string,
  ): Promise<ConnectedPlatformAccount> {
    const { platform } = this.requireValidState(state, userId);
    const provider = this.providerFor(platform);
    const tokens = await provider.exchangeCode(this.fetchFn, this.appCredentials(platform), code);
    await this.storeTokens(userId, platform, tokens);
    const account = await provider.describeAccount(this.fetchFn, tokens);
    await this.socialAccounts.connectVerified(userId, {
      platform,
      handle: account.handle ?? platform.toLowerCase(),
      platformAccountId: account.externalAccountId,
    });
    return { platform, ...account };
  }

  /** Forgets every stored platform token for the creator (used when they delete their account). */
  async disconnectAll(creatorUserId: string): Promise<void> {
    await this.prisma.socialOAuthToken.deleteMany({ where: { creatorUserId } });
  }

  /** Null when the creator has not connected (or their connection can no longer be used). */
  async credentialsFor(
    platform: SocialPlatform,
    creatorUserId: string,
  ): Promise<CreatorCredentials | null> {
    if (!this.vault.isAvailable()) {
      return null;
    }
    const stored = await this.prisma.socialOAuthToken.findUnique({
      where: { creatorUserId_platform: { creatorUserId, platform } },
    });
    if (!stored) {
      return null;
    }
    const tokens = this.toPlatformTokens(stored);
    const usable = await this.refreshIfExpiring(platform, creatorUserId, tokens);
    return usable
      ? { accessToken: usable.accessToken, externalAccountId: usable.externalAccountId }
      : null;
  }

  private async refreshIfExpiring(
    platform: SocialPlatform,
    creatorUserId: string,
    tokens: PlatformTokens,
  ): Promise<PlatformTokens | null> {
    const expiresSoon =
      tokens.expiresAt !== null && tokens.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
    if (!expiresSoon) {
      return tokens;
    }
    const refreshed = await this.providerFor(platform).refresh(
      this.fetchFn,
      this.appCredentials(platform),
      tokens,
    );
    if (!refreshed) {
      return tokens.expiresAt && tokens.expiresAt.getTime() > Date.now() ? tokens : null;
    }
    await this.storeTokens(creatorUserId, platform, refreshed);
    return refreshed;
  }

  private async storeTokens(
    creatorUserId: string,
    platform: SocialPlatform,
    tokens: PlatformTokens,
  ): Promise<void> {
    const data = {
      accessTokenEncrypted: this.vault.encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? this.vault.encrypt(tokens.refreshToken) : null,
      expiresAt: tokens.expiresAt,
      externalAccountId: tokens.externalAccountId,
    };
    await this.prisma.socialOAuthToken.upsert({
      where: { creatorUserId_platform: { creatorUserId, platform } },
      update: data,
      create: { creatorUserId, platform, ...data },
    });
  }

  private toPlatformTokens(stored: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    expiresAt: Date | null;
    externalAccountId: string | null;
  }): PlatformTokens {
    return {
      accessToken: this.vault.decrypt(stored.accessTokenEncrypted),
      refreshToken: stored.refreshTokenEncrypted
        ? this.vault.decrypt(stored.refreshTokenEncrypted)
        : null,
      expiresAt: stored.expiresAt,
      externalAccountId: stored.externalAccountId,
    };
  }

  private requireValidState(state: string, userId: string): OAuthState {
    const payload = this.vault.isAvailable() ? this.vault.verify(state) : null;
    const parsed = payload ? this.parseState(payload) : null;
    if (!parsed || parsed.userId !== userId || parsed.expiresAt <= Date.now()) {
      throw new BadRequestException('The connection request is invalid or has expired.');
    }
    return parsed;
  }

  private parseState(payload: string): OAuthState | null {
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    } catch {
      return null;
    }
  }

  private providerFor(platform: SocialPlatform): PlatformOAuth {
    const provider = this.providers.find((candidate) => candidate.platform === platform);
    if (!provider) {
      throw new BadRequestException(`${platform} accounts are not connected through OAuth.`);
    }
    return provider;
  }

  private appCredentials(platform: SocialPlatform): OAuthAppCredentials {
    const keys: Partial<Record<SocialPlatform, [keyof Env, keyof Env]>> = {
      INSTAGRAM: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
      TIKTOK: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
      YOUTUBE: ['YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET'],
      SNAPCHAT: ['SNAPCHAT_CLIENT_ID', 'SNAPCHAT_CLIENT_SECRET'],
    };
    const [idKey, secretKey] = keys[platform] ?? [];
    const clientId = idKey ? (this.config.get(idKey, { infer: true }) as string | undefined) : undefined;
    const clientSecret = secretKey
      ? (this.config.get(secretKey, { infer: true }) as string | undefined)
      : undefined;
    const redirectUri = this.config.get('SOCIAL_OAUTH_REDIRECT_URI', { infer: true });
    if (!clientId || !clientSecret || !redirectUri || !this.vault.isAvailable()) {
      throw new ServiceUnavailableException(`Connecting ${platform} is not configured yet.`);
    }
    return { clientId, clientSecret, redirectUri };
  }
}
