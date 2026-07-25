import { ValidationError } from '../errors/domain-error';

const PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The municipality identifier that appears in every URL path.
 *
 * Also the source of the Postgres schema name, which is why the character set is
 * this strict: `schemaNameFor()` interpolates the slug into DDL that cannot be
 * parameterised, so anything outside [a-z0-9-] must be impossible to construct
 * rather than merely escaped later.
 */
export class TenantSlug {
  private constructor(readonly value: string) {}

  static parse(raw: string): TenantSlug {
    const normalised = raw.trim().toLowerCase();

    if (normalised.length < 2 || normalised.length > 50) {
      throw new ValidationError('Municipality slug must be 2–50 characters');
    }
    if (!PATTERN.test(normalised)) {
      throw new ValidationError(
        'Municipality slug may contain only lowercase letters, digits and single hyphens',
      );
    }

    return new TenantSlug(normalised);
  }

  static isValid(raw: string): boolean {
    const normalised = raw.trim().toLowerCase();
    return normalised.length >= 2 && normalised.length <= 50 && PATTERN.test(normalised);
  }

  /**
   * Postgres schema name for this municipality. Hyphens become underscores
   * because an unquoted identifier cannot contain a hyphen, and quoting a name
   * that is sometimes quoted and sometimes not is how schema bugs start.
   */
  get schemaName(): string {
    return `tenant_${this.value.replace(/-/g, '_')}`;
  }

  toString(): string {
    return this.value;
  }
}
