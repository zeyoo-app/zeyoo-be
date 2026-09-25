import { ForbiddenException, Injectable } from '@nestjs/common';
import { OAuthProvider, User, UserType } from '@prisma/client';
import { AuthTokens, TokenService } from './token.service';
import { OAuthVerifier } from './oauth-verifier';
import { UserService } from './user.service';

interface OAuthSignInInput {
  provider: OAuthProvider;
  idToken: string;
  // Used only when this identity/email is new; ignored for returning users.
  userType: UserType;
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly users: UserService,
    private readonly tokens: TokenService,
    private readonly verifier: OAuthVerifier,
  ) {}

  async signIn(input: OAuthSignInInput): Promise<AuthTokens> {
    const profile = await this.verifier.verify(input.provider, input.idToken);
    const user = await this.resolveUser(input, profile.providerUserId, profile.email, profile.emailVerified);

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account is suspended.');
    }
    return this.tokens.issueFor(user);
  }

  private async resolveUser(
    input: OAuthSignInInput,
    providerUserId: string,
    email: string | null,
    emailVerified: boolean,
  ): Promise<User> {
    // 1. Returning social user — identity already linked.
    const linked = await this.users.findByOAuthIdentity(input.provider, providerUserId);
    if (linked) {
      return linked;
    }

    // 2. Existing account with the same email — link the social identity to it.
    if (email) {
      const existing = await this.users.findByEmail(email);
      if (existing) {
        await this.users.linkOAuthIdentity(existing.id, input.provider, providerUserId);
        return existing;
      }
    }

    // 3. Brand new account.
    return this.users.createOAuthUser({
      email,
      type: input.userType,
      emailVerified,
      provider: input.provider,
      providerUserId,
    });
  }
}
