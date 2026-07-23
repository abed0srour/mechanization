import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export const CITIZEN_JWT = 'citizen-jwt';

export interface SupabaseJwtPayload {
  sub: string;
  phone?: string;
  role?: string;
  exp: number;
}

/**
 * Citizens authenticate through Supabase Auth (phone OTP); this service only
 * verifies the token Supabase issued. No password or OTP handling lives here,
 * which keeps SMS delivery and rate limiting out of our codebase entirely.
 */
@Injectable()
export class CitizenJwtStrategy extends PassportStrategy(Strategy, CITIZEN_JWT) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.SUPABASE_JWT_SECRET as string,
      audience: 'authenticated',
    });
  }

  async validate(payload: SupabaseJwtPayload): Promise<SupabaseJwtPayload> {
    if (!payload?.sub) throw new UnauthorizedException('Malformed session token');
    if (!payload.phone) {
      throw new UnauthorizedException('This account has no verified phone number');
    }
    return payload;
  }
}
