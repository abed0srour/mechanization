import { ValidationError } from '../errors/domain-error';

/**
 * رقم مرجعي — the fallback identifier a citizen keeps when a phone is lost or
 * shared between a household. Format: <PREFIX>-<YY><MM>-<6 chars>, e.g.
 * "BZR-2607-4K9QX2".
 *
 * The alphabet deliberately excludes I, O, 0 and 1 so the code survives being
 * read aloud over the phone or copied by hand from an SMS by an elderly user —
 * the exact population this system exists to serve.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PATTERN = /^[A-Z]{3}-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export class ReferenceNumber {
  private constructor(readonly value: string) {}

  static generate(
    tenantPrefix: string,
    now: Date = new Date(),
    randomInt: (max: number) => number = (max) => Math.floor(Math.random() * max),
  ): ReferenceNumber {
    const prefix = tenantPrefix
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3)
      .padEnd(3, 'X');
    const yy = String(now.getUTCFullYear()).slice(-2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

    let suffix = '';
    for (let i = 0; i < 6; i += 1) {
      suffix += ALPHABET[randomInt(ALPHABET.length)];
    }

    return new ReferenceNumber(`${prefix}-${yy}${mm}-${suffix}`);
  }

  /** Accepts what a citizen actually types: spaces, lowercase, missing dashes. */
  static parse(raw: string): ReferenceNumber {
    const normalised = raw.trim().toUpperCase().replace(/\s/g, '');
    if (!PATTERN.test(normalised)) {
      throw new ValidationError('الرقم المرجعي غير صالح');
    }
    return new ReferenceNumber(normalised);
  }

  static isValid(raw: string): boolean {
    return PATTERN.test(raw.trim().toUpperCase().replace(/\s/g, ''));
  }

  toString(): string {
    return this.value;
  }
}
