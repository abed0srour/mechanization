import { PhoneNumber } from './phone-number.vo';
import { ReferenceNumber } from './reference-number.vo';
import { TenantSlug } from './tenant-slug.vo';
import { ValidationError } from '../errors/domain-error';

describe('PhoneNumber', () => {
  /**
   * The same person types their number a different way on every visit, and OTP
   * login looks them up *by phone* — without one canonical form a citizen
   * silently fails to find their own account.
   */
  it.each([
    ['03 123456', '+9613123456'],
    ['3123456', '+9613123456'],
    ['+961 3 123 456', '+9613123456'],
    ['0096171234567', '+96171234567'],
    ['70-123-456', '+96170123456'],
    ['(71) 234 567', '+96171234567'],
  ])('normalises %s to %s', (input, expected) => {
    expect(PhoneNumber.parse(input).e164).toBe(expected);
  });

  it.each(['', '123', '+1 555 0100', '0612345678', 'abcdefg'])('rejects %s', (input) => {
    expect(() => PhoneNumber.parse(input)).toThrow(ValidationError);
  });

  it('masks all but the last four digits', () => {
    expect(PhoneNumber.parse('03123456').masked).toBe('••• 3456');
  });
});

describe('TenantSlug', () => {
  it('derives a Postgres schema name, converting hyphens to underscores', () => {
    // An unquoted Postgres identifier cannot contain a hyphen, and a name that
    // is sometimes quoted and sometimes not is where schema bugs start.
    expect(TenantSlug.parse('albazourieh').schemaName).toBe('tenant_albazourieh');
    expect(TenantSlug.parse('deir-el-qamar').schemaName).toBe('tenant_deir_el_qamar');
  });

  it('lowercases and trims', () => {
    expect(TenantSlug.parse('  Zahle  ').value).toBe('zahle');
  });

  /**
   * These are the inputs that matter: the slug is interpolated into DDL that
   * cannot be parameterised, so anything outside [a-z0-9-] must be impossible
   * to construct rather than escaped downstream.
   */
  it.each([
    'a',
    '-leading',
    'trailing-',
    'double--hyphen',
    'has space',
    'has_underscore',
    'DROP TABLE users',
    'tenant";DROP SCHEMA public;--',
  ])('rejects %s', (input) => {
    expect(() => TenantSlug.parse(input)).toThrow(ValidationError);
  });
});

describe('ReferenceNumber', () => {
  it('generates the documented format', () => {
    const reference = ReferenceNumber.generate('BZR', new Date(Date.UTC(2026, 6, 25)));
    expect(reference.value).toMatch(/^BZR-2607-[A-Z0-9]{6}$/);
  });

  it('excludes characters that are misread aloud or by hand', () => {
    // I/O/0/1 are absent on purpose: an elderly citizen reads this code back to
    // a clerk over the phone, or copies it from an SMS.
    const generated = Array.from({ length: 200 }, () => ReferenceNumber.generate('BZR').value);
    const suffixes = generated.map((value) => value.split('-')[2]).join('');
    expect(suffixes).not.toMatch(/[IO01]/);
  });

  it('pads a short prefix rather than producing a malformed code', () => {
    expect(ReferenceNumber.generate('Z').value).toMatch(/^ZXX-/);
  });

  it('accepts what a citizen actually types', () => {
    expect(ReferenceNumber.parse(' bzr-2607-4k9qx2 ').value).toBe('BZR-2607-4K9QX2');
  });

  it('rejects a malformed reference', () => {
    expect(() => ReferenceNumber.parse('BZR-2607-4K9QX')).toThrow(ValidationError);
    expect(() => ReferenceNumber.parse('nonsense')).toThrow(ValidationError);
  });
});
