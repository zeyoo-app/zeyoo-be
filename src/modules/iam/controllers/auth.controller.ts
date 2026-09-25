import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { OAuthProvider } from '@prisma/client';
import { CurrentUser, Principal, Public } from '@platform/auth';
import {
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  OAuthSignInDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '../dto/auth.dto';
import { AuthService } from '../services/auth.service';
import { OAuthService } from '../services/oauth.service';
import { AuthTokens } from '../services/token.service';

const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: 'GOOGLE',
  apple: 'APPLE',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.auth.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto);
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

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('email/verify')
  verifyEmail(@CurrentUser() principal: Principal, @Body() dto: VerifyEmailDto): Promise<void> {
    return this.auth.verifyEmail(principal.userId, dto.code);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('email/resend')
  resendEmailVerification(@CurrentUser() principal: Principal): Promise<void> {
    return this.auth.resendEmailVerification(principal.userId);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('password/forgot')
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto.email, dto.code, dto.newPassword);
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
