import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { TotpService } from '../../domain/interfaces/otp-repository.interface';

/**
 * TOTP for SUPER_ADMIN, which v2 made mandatory rather than "worth considering".
 *
 * A SUPER_ADMIN can read every citizen's national ID number, residency status
 * and scanned documents for their municipality, and can export the lot to CSV.
 * A single reused password should not be all that stands in front of that.
 */
/** Shared by the verifier and `currentStep`, so the two cannot drift apart. */
const STEP_SECONDS = 30;

@Injectable()
export class OtplibTotpService implements TotpService {
  constructor() {
    authenticator.options = {
      // Two steps of tolerance each way (60s past & 60s future): phone clocks drift,
      // and the alternative is locking an admin out over a few seconds of clock skew.
      window: 2,
      step: STEP_SECONDS,
    };
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(secret: string, accountName: string, issuer: string): string {
    return authenticator.keyuri(accountName, issuer, secret);
  }

  /**
   * Derived from the same 30-second step the verifier uses, so the number
   * stored alongside an accepted code describes exactly the window that code
   * was valid in.
   */
  currentStep(now: Date = new Date()): number {
    return Math.floor(now.getTime() / 1000 / STEP_SECONDS);
  }

  verify(token: string, secret: string): boolean {
    try {
      const cleanToken = token.replace(/[\s-]/g, '').trim();
      const cleanSecret = secret.replace(/\s/g, '').trim();
      return (
        authenticator.verify({ token: cleanToken, secret: cleanSecret }) ||
        authenticator.check(cleanToken, cleanSecret)
      );
    } catch {
      // A malformed token is a failed check, not a 500.
      return false;
    }
  }
}
