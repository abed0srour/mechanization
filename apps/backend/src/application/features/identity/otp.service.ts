import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  OTP_REPOSITORY,
  PASSWORD_HASHER,
  SMS_SENDER,
} from '../../../domain/interfaces/base-repository.interface';
import {
  OtpChannel,
  OtpRepository,
  PasswordHasher,
  SmsSender,
} from '../../../domain/interfaces/otp-repository.interface';
import { PhoneNumber } from '../../../domain/value-objects/phone-number.vo';
import { ConflictError, UnauthorizedError, ValidationError } from '../../common/exceptions';
import { APP_CONFIG } from '../../../presentation/config/app.config';

export interface OtpIssueResult {
  channel: OtpChannel;
  expiresAt: Date;
  resendAvailableAt: Date;
  /** Development only — lets a developer without SMS credentials finish login. */
  devCode?: string;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(OTP_REPOSITORY) private readonly challenges: OtpRepository,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Issues a code and sends it.
   *
   * `attempt` is the citizen's resend count for this session. From
   * `fallbackAfterAttempt` onward, delivery switches to the second route: if the
   * first provider is the reason the code never arrived, retrying it is not a
   * fallback, it is the same failure again.
   */
  async issue(rawPhone: string, attempt = 1): Promise<OtpIssueResult> {
    const phone = PhoneNumber.parse(rawPhone);

    const hourAgo = new Date(Date.now() - 3_600_000);
    const recent = await this.challenges.countRecent(phone.e164, hourAgo);
    if (recent >= APP_CONFIG.otp.maxPerHour) {
      // Protects the citizen from SMS-bombing and the municipality from the bill.
      throw new ConflictError('تم إرسال عدد كبير من الرموز — يرجى المحاولة بعد ساعة');
    }

    const code = String(randomInt(0, 10 ** APP_CONFIG.otp.codeLength)).padStart(
      APP_CONFIG.otp.codeLength,
      '0',
    );
    const codeHash = await this.hasher.hash(code);
    const expiresAt = new Date(Date.now() + APP_CONFIG.otp.ttlSeconds * 1000);

    const channel: OtpChannel =
      attempt >= APP_CONFIG.otp.fallbackAfterAttempt && this.sms.hasFallback
        ? 'FALLBACK'
        : 'PRIMARY';

    await this.challenges.create({ phone: phone.e164, codeHash, channel, expiresAt });

    try {
      await this.sms.send({
        phone: phone.e164,
        message: `رمز الدخول: ${code}\nصالح لمدة ${APP_CONFIG.otp.ttlSeconds / 60} دقائق.`,
        channel,
      });
    } catch (error) {
      // The challenge row stays: a delivery failure must not also invalidate a
      // code that may yet arrive late. The citizen can resend, which will take
      // the other route.
      this.logger.error(
        `OTP delivery failed on ${channel} for ${phone.masked}: ${
          error instanceof Error ? error.message : error
        }`,
      );

      /**
       * Outside production, a delivery failure is the *expected* state rather
       * than an incident: no provider has been chosen yet, so
       * `SmsProviderService.deliver()` throws by design (see
       * docs/open-decisions.md #2). Rethrowing here made citizen login
       * impossible to exercise locally — every request died on this line, and
       * the `devCode` returned below, which exists precisely so a developer
       * without SMS credentials can finish signing in, was unreachable.
       *
       * The challenge row is already written, so the code returned below is a
       * real, verifiable one. Production still fails loudly: there, a code
       * nobody received is a citizen locked out, not a convenience.
       */
      if (process.env.NODE_ENV === 'production') {
        throw new ConflictError(
          'تعذّر إرسال الرمز حالياً. يرجى إعادة المحاولة، أو مراجعة البلدية لتسجيل طلبك.',
        );
      }

      this.logger.warn(
        `Continuing without SMS delivery (NODE_ENV=${process.env.NODE_ENV ?? 'development'}) — ` +
          'the code is returned in the response as devCode.',
      );
    }

    return {
      channel,
      expiresAt,
      resendAvailableAt: new Date(Date.now() + APP_CONFIG.otp.resendCooldownSeconds * 1000),
      devCode: process.env.NODE_ENV === 'production' ? undefined : code,
    };
  }

  /**
   * Verifies a submitted code. Returns the phone in canonical form so the caller
   * looks up citizens by exactly what was stored.
   */
  async verify(rawPhone: string, code: string): Promise<string> {
    const phone = PhoneNumber.parse(rawPhone);
    const challenge = await this.challenges.findActive(phone.e164);

    if (!challenge) {
      throw new UnauthorizedError('الرمز غير صالح أو منتهي الصلاحية');
    }

    if (challenge.attempts >= APP_CONFIG.otp.maxAttempts) {
      await this.challenges.consume(challenge.id);
      throw new UnauthorizedError('تم تجاوز عدد المحاولات — يرجى طلب رمز جديد');
    }

    const matches = await this.hasher.verify(code.trim(), challenge.codeHash);
    if (!matches) {
      const attempts = await this.challenges.incrementAttempts(challenge.id);
      if (attempts >= APP_CONFIG.otp.maxAttempts) {
        await this.challenges.consume(challenge.id);
      }
      throw new UnauthorizedError('الرمز غير صحيح');
    }

    // Single-use: a code that still works after login is a code worth stealing.
    await this.challenges.consume(challenge.id);
    return phone.e164;
  }

  /** Scheduled cleanup — see application/background-jobs/. */
  async pruneExpired(): Promise<number> {
    return this.challenges.deleteExpired(new Date());
  }

  assertDeliverable(): void {
    if (!this.sms.hasFallback && process.env.NODE_ENV === 'production') {
      throw new ValidationError('No fallback SMS route configured');
    }
  }
}
