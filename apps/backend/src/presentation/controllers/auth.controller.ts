import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  changeEmailSchema,
  changePasswordSchema,
  referenceLoginSchema,
  referenceOnlyLoginSchema,
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

  @Post('staff/change-password')
  async changePassword(
    @Param('tenantSlug') tenantSlug: string,
    @CurrentUser() user: SessionClaims,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: { currentPassword: string; newPassword: string },
  ) {
    await this.identity.changeStaffPassword(user.sub, tenantSlug, body.currentPassword, body.newPassword);
    return { changed: true };
  }

  @Post('staff/change-email')
  async changeEmail(
    @Param('tenantSlug') tenantSlug: string,
    @CurrentUser() user: SessionClaims,
    @Body(new ZodValidationPipe(changeEmailSchema))
    body: { newEmail: string; currentPassword: string },
  ) {
    const result = await this.identity.changeStaffEmail(user.sub, tenantSlug, body.newEmail, body.currentPassword);
    return result;
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
      /**
       * Whether the login page should ask for a code at all. Reported rather
       * than assumed by the client: the switch lives in the server's
       * environment, and a page guessing wrong either strands the citizen on a
       * code screen no SMS will ever answer, or skips a step that is still
       * enforced.
       */
      otpRequired: this.identity.otpRequired,
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
    body: { phone: string; code?: string; citizenId?: string },
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

  /**
   * Sign-in by رقم مرجعي + phone, for the payments portal.
   *
   * Rate-limited like the staff login rather than like the OTP request: this
   * one *is* the credential check, so it is the endpoint worth guessing at.
   */
  @Public()
  @Post('citizen/reference/login')
  @Throttle({
    default: {
      limit: APP_CONFIG.throttle.staffLogin.limit,
      ttl: APP_CONFIG.throttle.staffLogin.ttlSeconds * 1000,
    },
  })
  async loginByReference(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(referenceLoginSchema))
    body: { referenceNumber: string; phone: string },
    @Req() request: Request,
  ) {
    return this.identity.loginByReference({
      tenantSlug,
      referenceNumber: body.referenceNumber,
      phone: body.phone,
      context: { ip: request.ip, userAgent: request.header('user-agent') },
    });
  }

  /**
   * Sign-in by رقم مرجعي alone — the citizen landing page.
   *
   * Throttled harder than any other route here: 5 attempts a minute, as the
   * two-factor version gets, is sized for someone mistyping their own number.
   * This one is the whole credential, so it is the only endpoint where a
   * patient attacker with a list is a realistic shape of attack — and at this
   * rate, the reference's 2³⁰ suffix space is unreachable by orders of
   * magnitude.
   */
  @Public()
  @Post('citizen/reference/open')
  @Throttle({
    default: {
      limit: APP_CONFIG.throttle.referenceOnlyLogin.limit,
      ttl: APP_CONFIG.throttle.referenceOnlyLogin.ttlSeconds * 1000,
    },
  })
  async openByReference(
    @Param('tenantSlug') tenantSlug: string,
    @Body(new ZodValidationPipe(referenceOnlyLoginSchema))
    body: { referenceNumber: string },
    @Req() request: Request,
  ) {
    return this.identity.loginByReferenceOnly({
      tenantSlug,
      referenceNumber: body.referenceNumber,
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
