import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { StaffJwtPayload } from '../application/login-staff.use-case';

export const STAFF_JWT = 'staff-jwt';

@Injectable()
export class StaffJwtStrategy extends PassportStrategy(Strategy, STAFF_JWT) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: StaffJwtPayload): Promise<StaffJwtPayload> {
    if (!payload?.sub || !payload?.tenantId) {
      throw new UnauthorizedException('Malformed session token');
    }
    return payload;
  }
}
