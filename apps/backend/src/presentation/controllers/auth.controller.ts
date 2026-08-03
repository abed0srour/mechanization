import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  requestOtpSchema,
  staffLoginSchema,
  totpEnrolmentSchema,
  verifyOtpSchema,
} from '@mechanization/shared-schemas';
import { IdentityService } from '../../application/features/identity/identity.service';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';
import { APP_CONFIG } from '../config/app.config';

/**
 * One controller for both kinds of sign-in — the routes differ, the token they
 * produce does not.
 */
@Controller('t/:tenantSlug/auth')
export class AuthController {
  constructor(private readonly identity: IdentityService) {}

  // ────────────────────────────  Staff  ────────────────────────────

  @Public()
  @Post('staff/login')
  @Throttle({
    default: {
      limit: APP_CONFIG.throttle.staffLogin.limit,
      ttl: APP_CONFIG.throttle.staffLogin.ttlSeconds * 1000,
    },
  })
  /**
   * The pipe sits on `@Body()` specifically rather than on `@UsePipes()` at the
   * method: a method-level pipe runs against every parameter of the handler,
   * so `staffLoginSchema` would also validate `tenantSlug` — a plain string —
   * and fail every login with "Expected object, received string" before the
   * password was ever checked.
   */
  async loginStaff(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(staffLoginSchema))
    body: { email: string; password: string; totpToken?: string; remember?: boolean },
    @Req() request: Request,
  ) {
    return this.identity.loginStaff({
      tenantSlug,
      email: body.email,
      password: body.password,
      totpToken: body.totpToken,
      remember: body.remember,
      context: { ip: request.ip, userAgent: request.header('user-agent') },
    });
  }

  /**
   * Enrolment is authenticated: an admin who has not yet set up TOTP can still
   * sign in only if their role does not require it, and a SUPER_ADMIN's first
   * secret is issued by a colleague who already has access (see seed.ts).
   */
  @Post('staff/totp/enrol')
  async beginTotpEnrolment(
    @Param('tenantSlug') tenantSlug: string,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.identity.beginTotpEnrolment(user.sub, tenantSlug);
  }

  @Post('staff/totp/confirm')
  async confirmTotpEnrolment(
    @CurrentUser() user: SessionClaims,
    @Body(new ZodValidationPipe(totpEnrolmentSchema)) body: { token: string },
  ) {
    await this.identity.confirmTotpEnrolment(user.sub, body.token);
    return { confirmed: true };
  }

  // ───────────────────────────  Citizens  ───────────────────────────

  @Public()
  @Post('citizen/otp/request')
  @Throttle({
    default: {
      limit: APP_CONFIG.throttle.otpRequest.limit,
      ttl: APP_CONFIG.throttle.otpRequest.ttlSeconds * 1000,
    },
  })
  async requestOtp(
    @Body(new ZodValidationPipe(requestOtpSchema)) body: { phone: string; attempt: number },
  ) {
    const result = await this.identity.requestOtp(body.phone, body.attempt);

    return {
      // Never echo whether the phone is known — that would turn this endpoint
      // into a way to test which numbers have registered with the municipality.
      sent: true,
      channel: result.channel,
      expiresAt: result.expiresAt.toISOString(),
      resendAvailableAt: result.resendAvailableAt.toISOString(),
      ...(result.devCode ? { devCode: result.devCode } : {}),
    };
  }

  @Public()
  @Post('citizen/otp/verify')
  async verifyOtp(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(verifyOtpSchema))
    body: { phone: string; code: string; citizenId?: string },
    @Req() request: Request,
  ) {
    return this.identity.verifyOtp({
      tenantSlug,
      phone: body.phone,
      code: body.code,
      citizenId: body.citizenId,
      context: { ip: request.ip, userAgent: request.header('user-agent') },
    });
  }

  // ────────────────────────────  Shared  ────────────────────────────

  /** Lets the frontend confirm a stored token is still valid on page load. */
  @Get('me')
  me(@CurrentUser() user: SessionClaims) {
    return { id: user.sub, kind: user.kind, role: user.role, tenantSlug: user.tenantSlug };
  }
}
