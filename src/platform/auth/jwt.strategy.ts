import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Env } from '../config/env.schema';
import { permissionsForRole } from '../rbac/roles';
import { AccessTokenClaims } from './access-token';
import { Principal } from './principal';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  validate(claims: AccessTokenClaims): Principal {
    return {
      userId: claims.sub,
      email: claims.email,
      role: claims.role,
      permissions: permissionsForRole(claims.role),
    };
  }
}
