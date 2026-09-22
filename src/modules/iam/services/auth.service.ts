import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserType } from '@prisma/client';
import { LoginDto, RegisterDto } from '../dto/auth.dto';
import { AuthTokens, TokenService } from './token.service';
import { PasswordService } from './password.service';
import { UserService } from './user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.createWithPassword({
      email: dto.email,
      passwordHash,
      type: dto.userType as UserType,
    });
    return this.tokens.issueFor(user);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.users.findByEmailWithCredential(dto.email);
    if (!user?.credential) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await this.passwords.verify(user.credential.passwordHash, dto.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account is suspended.');
    }
    return this.tokens.issueFor(user);
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }
}
