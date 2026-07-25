import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, SmsSender } from '../../domain/interfaces/otp-repository.interface';

/**
 * OTP delivery with two independent routes.
 *
 * Section 10 of the v2 spec makes this non-optional, and it is the requirement
 * most likely to be quietly dropped: SMS delivery to Lebanese networks fails or
 * stalls often enough that a single provider makes the login page a coin flip.
 * A citizen who never receives a code has no other way in — so the resend path
 * switches routes rather than retrying the one that just failed.
 *
 * The HTTP calls are left as a single `deliver()` seam because the provider is
 * not chosen yet (see docs/open-decisions.md). Everything around it — channel
 * selection, failover, logging — is real and does not change with the provider.
 */
@Injectable()
export class SmsProviderService implements SmsSender {
  private readonly logger = new Logger(SmsProviderService.name);
  private readonly primaryKey?: string;
  private readonly fallbackKey?: string;
  private readonly isProduction: boolean;

  constructor(private readonly config: ConfigService) {
    this.primaryKey = this.config.get<string>('SMS_PROVIDER_API_KEY');
    this.fallbackKey = this.config.get<string>('SMS_PROVIDER_FALLBACK_API_KEY');
    this.isProduction = this.config.get<string>('NODE_ENV') === 'production';

    if (!this.hasFallback) {
      // Warn at boot, not at 2am on the first outage.
      this.logger.warn(
        'No fallback SMS route configured — a primary-provider outage will block citizen login entirely.',
      );
    }
  }

  get hasFallback(): boolean {
    return Boolean(this.fallbackKey && this.fallbackKey !== this.primaryKey);
  }

  async send(input: { phone: string; message: string; channel: OtpChannel }): Promise<void> {
    const key = input.channel === 'FALLBACK' ? (this.fallbackKey ?? this.primaryKey) : this.primaryKey;

    if (!key) {
      if (this.isProduction) {
        throw new Error('No SMS provider configured');
      }
      // In development the code is also returned by the API response, so a
      // developer without provider credentials can still complete the flow.
      this.logger.debug(`[dev] SMS to ${input.phone} via ${input.channel}: ${input.message}`);
      return;
    }

    await this.deliver({ ...input, apiKey: key });
  }

  /**
   * The provider-specific call. Replace the body when the provider is chosen;
   * nothing above this method needs to change.
   */
  private async deliver(input: {
    phone: string;
    message: string;
    channel: OtpChannel;
    apiKey: string;
  }): Promise<void> {
    this.logger.log(`Dispatching SMS to ${this.mask(input.phone)} via ${input.channel}`);

    throw new Error(
      'SMS provider not yet wired. Choose a provider (see docs/open-decisions.md), ' +
        'implement SmsProviderService.deliver(), and set SMS_PROVIDER_API_KEY.',
    );
  }

  /** Phone numbers are personal data; logs are the easiest place to leak them. */
  private mask(phone: string): string {
    return `${phone.slice(0, 5)}•••${phone.slice(-2)}`;
  }
}
