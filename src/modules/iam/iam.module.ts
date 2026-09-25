import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '@platform/config/env.schema';
import { ApiKeysController } from './controllers/api-keys.controller';
import { AuthController } from './controllers/auth.controller';
import { MeController } from './controllers/me.controller';
import { MembersController } from './controllers/members.controller';
import { OrganizationsController } from './controllers/organizations.controller';
import { ApiKeyService } from './services/api-key.service';
import { AuthService } from './services/auth.service';
import { MembershipService } from './services/membership.service';
import { OAuthService } from './services/oauth.service';
import { IdTokenOAuthVerifier, OAuthVerifier } from './services/oauth-verifier';
import { OrganizationService } from './services/organization.service';
import { PasswordService } from './services/password.service';
import { ProfileService } from './services/profile.service';
import { TokenService } from './services/token.service';
import { UserService } from './services/user.service';
import { VerificationCodeService } from './services/verification-code.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  controllers: [
    AuthController,
    MeController,
    OrganizationsController,
    MembersController,
    ApiKeysController,
  ],
  providers: [
    AuthService,
    OAuthService,
    { provide: OAuthVerifier, useClass: IdTokenOAuthVerifier },
    VerificationCodeService,
    TokenService,
    PasswordService,
    UserService,
    ProfileService,
    OrganizationService,
    MembershipService,
    ApiKeyService,
  ],
  exports: [UserService, OrganizationService, MembershipService],
})
export class IamModule {}
