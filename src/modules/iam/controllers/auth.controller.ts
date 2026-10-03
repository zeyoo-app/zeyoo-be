import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { OAuthProvider, UserType } from '@prisma/client';
import { Public } from '@platform/auth';
import {
  LogoutDto,
  OAuthSignInDto,
  RefreshDto,
  RequestEmailCodeDto,
  RequestPhoneCodeDto,
  VerifyEmailCodeDto,
  VerifyPhoneCodeDto,
} from '../dto/auth.dto';
import { AuthService, SignInResult } from '../services/auth.service';
import { OAuthService } from '../services/oauth.service';
import { AuthTokens } from '../services/token.service';

const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: 'GOOGLE',
  apple: 'APPLE',
};

/** "someone@gmail.com" -> "s***@gmail.com", for confirming where a code went. */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
  ) {}

  // Emails a 6-digit code. Sign-in and sign-up share this endpoint because the
  // address alone cannot say which one it is, and answering differently would turn
  // it into an account-enumeration oracle. Nothing is created until the code is
  // verified.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('email/code')
  async requestEmailCode(@Body() dto: RequestEmailCodeDto): Promise<{ message: string }> {
    await this.auth.requestEmailCode(dto.email);
    return { message: `We sent a 6-digit code to ${maskEmail(dto.email)}.` };
  }

  // Exchanges an emailed code for a session, creating the account when the
  // address is new. `isNewUser` tells the client whether to start onboarding.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('email/code/verify')
  verifyEmailCode(@Body() dto: VerifyEmailCodeDto): Promise<SignInResult> {
    return this.auth.verifyEmailCode(dto.email, dto.code, dto.userType as UserType | undefined);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  // Texts a 6-digit code to a phone number. Same shape as the email endpoint.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('phone/code')
  async requestPhoneCode(@Body() dto: RequestPhoneCodeDto): Promise<{ message: string }> {
    await this.auth.requestPhoneCode(dto.phone);
    return { message: 'We sent a 6-digit code by text message.' };
  }

  // Exchanges a texted code for a session, creating the account when the number
  // is new. Returns the same shape as the email endpoint.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('phone/code/verify')
  verifyPhoneCode(@Body() dto: VerifyPhoneCodeDto): Promise<SignInResult> {
    return this.auth.verifyPhoneCode(dto.phone, dto.code, dto.userType as UserType | undefined);
  }

  @Public()
  @ApiParam({ name: 'provider', enum: ['google', 'apple'] })
  @HttpCode(HttpStatus.OK)
  @Post('oauth/:provider')
  oauthSignIn(
    @Param('provider') provider: string,
    @Body() dto: OAuthSignInDto,
  ): Promise<AuthTokens> {
    const resolved = OAUTH_PROVIDERS[provider.toLowerCase()];
    if (!resolved) {
      throw new BadRequestException(`Unsupported OAuth provider: ${provider}`);
    }
    return this.oauth.signIn({
      provider: resolved,
      idToken: dto.idToken,
      userType: dto.userType,
    });
  }
}
