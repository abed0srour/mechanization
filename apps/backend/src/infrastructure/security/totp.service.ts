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
@Injectable()
export class OtplibTotpService implements TotpService {
  constructor() {
    authenticator.options = {
      // One step of tolerance each way: phone clocks drift, and the alternative
      // is locking an admin out of their own dashboard over a few seconds.
      window: 1,
      step: 30,
    };
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(secret: string, accountName: string, issuer: string): string {
    return authenticator.keyuri(accountName, issuer, secret);
  }

  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token: token.replace(/\s/g, ''), secret });
    } catch {
      // A malformed token is a failed check, not a 500.
      return false;
    }
  }
}
