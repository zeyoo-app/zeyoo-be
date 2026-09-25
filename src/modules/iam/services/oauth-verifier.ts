import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthProvider } from '@prisma/client';
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';
import { Env } from '@platform/config/env.schema';

/** The trusted identity extracted from a verified provider ID token. */
export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
}

/** Port for validating a social provider's ID token and returning its subject. */
export abstract class OAuthVerifier {
  abstract verify(provider: OAuthProvider, idToken: string): Promise<OAuthProfile>;
}

interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
}

interface JwksKey extends JsonWebKey {
  kid?: string;
  alg?: string;
}

const ISSUERS: Record<OAuthProvider, string[]> = {
  GOOGLE: ['https://accounts.google.com', 'accounts.google.com'],
  APPLE: ['https://appleid.apple.com'],
};

const JWKS_URLS: Record<OAuthProvider, string> = {
  GOOGLE: 'https://www.googleapis.com/oauth2/v3/certs',
  APPLE: 'https://appleid.apple.com/auth/keys',
};

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Verifies Google/Apple ID tokens (RS256) against the provider JWKS using Node's
 * built-in crypto — no external dependency. It validates signature, issuer,
 * audience (the configured client IDs) and expiry.
 *
 * When a provider has no configured client IDs AND the app is not in production,
 * it falls back to trusting the token's decoded claims WITHOUT signature
 * verification, so social sign-in is exercisable locally without real provider
 * credentials. This bypass is refused in production.
 */
@Injectable()
export class IdTokenOAuthVerifier extends OAuthVerifier {
  private readonly logger = new Logger('OAuthVerifier');
  private readonly jwksCache = new Map<string, { keys: JwksKey[]; fetchedAt: number }>();

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async verify(provider: OAuthProvider, idToken: string): Promise<OAuthProfile> {
    const segments = idToken.split('.');
    if (segments.length !== 3) {
      throw new UnauthorizedException('Malformed ID token.');
    }
    const [headerB64, payloadB64, signatureB64] = segments as [string, string, string];

    const header = this.decodeSegment<{ alg?: string; kid?: string }>(headerB64);
    const claims = this.decodeSegment<IdTokenClaims>(payloadB64);
    const audiences = this.allowedAudiences(provider);

    if (audiences.length === 0) {
      this.assertDevBypassAllowed(provider);
    } else {
      await this.verifySignature(provider, header, headerB64, payloadB64, signatureB64);
      this.assertAudience(claims, audiences);
    }

    this.assertIssuer(provider, claims);
    this.assertNotExpired(claims);

    if (!claims.sub) {
      throw new UnauthorizedException('ID token is missing a subject.');
    }

    return {
      providerUserId: claims.sub,
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    };
  }

  private allowedAudiences(provider: OAuthProvider): string[] {
    const raw =
      provider === 'GOOGLE'
        ? this.config.get('GOOGLE_OAUTH_CLIENT_IDS', { infer: true })
        : this.config.get('APPLE_OAUTH_CLIENT_IDS', { infer: true });
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private assertDevBypassAllowed(provider: OAuthProvider): void {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new UnauthorizedException(`${provider} sign-in is not configured.`);
    }
    this.logger.warn(
      `${provider} ID token accepted WITHOUT signature verification (no client IDs configured; dev only).`,
    );
  }

  private async verifySignature(
    provider: OAuthProvider,
    header: { alg?: string; kid?: string },
    headerB64: string,
    payloadB64: string,
    signatureB64: string,
  ): Promise<void> {
    if (header.alg !== 'RS256') {
      throw new UnauthorizedException('Unsupported ID token signature algorithm.');
    }
    const jwk = await this.resolveKey(provider, header.kid);
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, 'base64url');

    if (!cryptoVerify('RSA-SHA256', signingInput, publicKey, signature)) {
      throw new UnauthorizedException('ID token signature is invalid.');
    }
  }

  private async resolveKey(provider: OAuthProvider, kid: string | undefined): Promise<JwksKey> {
    const keys = await this.fetchJwks(provider);
    const key = kid ? keys.find((candidate) => candidate.kid === kid) : keys[0];
    if (!key) {
      throw new UnauthorizedException('ID token signing key not found.');
    }
    return key;
  }

  private async fetchJwks(provider: OAuthProvider): Promise<JwksKey[]> {
    const url = JWKS_URLS[provider];
    const cached = this.jwksCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
      return cached.keys;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new UnauthorizedException('Unable to fetch provider signing keys.');
    }
    const body = (await response.json()) as { keys?: JwksKey[] };
    const keys = body.keys ?? [];
    this.jwksCache.set(url, { keys, fetchedAt: Date.now() });
    return keys;
  }

  private assertAudience(claims: IdTokenClaims, audiences: string[]): void {
    const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const matches = tokenAudiences.some((aud) => aud !== undefined && audiences.includes(aud));
    if (!matches) {
      throw new UnauthorizedException('ID token audience is not recognised.');
    }
  }

  private assertIssuer(provider: OAuthProvider, claims: IdTokenClaims): void {
    if (!claims.iss || !ISSUERS[provider].includes(claims.iss)) {
      throw new UnauthorizedException('ID token issuer is not recognised.');
    }
  }

  private assertNotExpired(claims: IdTokenClaims): void {
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException('ID token has expired.');
    }
  }

  private decodeSegment<T>(segment: string): T {
    try {
      return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException('Malformed ID token.');
    }
  }
}
