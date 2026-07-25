import { ConfigService } from '@nestjs/config';
import { TenantPrismaFactory } from './tenant-prisma.factory';

/**
 * The other half of the isolation test: the guard stops a cross-tenant *token*,
 * this stops a cross-tenant *client*.
 *
 * Under schema-per-tenant, handing out the wrong PrismaClient is the only way
 * one municipality can read another's rows — so the cache keying and the schema
 * name validation are the properties worth pinning down.
 */
describe('TenantPrismaFactory', () => {
  const config = {
    getOrThrow: () =>
      'postgresql://user:pass@localhost:6543/postgres?pgbouncer=true&connection_limit=1',
  } as unknown as ConfigService;

  let factory: TenantPrismaFactory;

  beforeEach(() => {
    factory = new TenantPrismaFactory(config);
  });

  it('returns the same client for the same schema', () => {
    // One pool per municipality, not one per request.
    expect(factory.forSchema('tenant_albazourieh')).toBe(factory.forSchema('tenant_albazourieh'));
    expect(factory.cachedSchemas).toEqual(['tenant_albazourieh']);
  });

  it('never returns one tenant a client cached for another', () => {
    const a = factory.forSchema('tenant_albazourieh');
    const b = factory.forSchema('tenant_zahle');

    expect(a).not.toBe(b);
    expect(factory.cachedSchemas.sort()).toEqual(['tenant_albazourieh', 'tenant_zahle']);
  });

  it('points each client at its own schema in the connection string', () => {
    const url = (factory as unknown as { connectionUrlFor(name: string): string }).connectionUrlFor(
      'tenant_zahle',
    );

    expect(new URL(url).searchParams.get('schema')).toBe('tenant_zahle');
    // The pooled Supabase URL already carries query parameters; appending a
    // second `?` would produce a string that only fails under load.
    expect(new URL(url).searchParams.get('pgbouncer')).toBe('true');
    expect(new URL(url).searchParams.get('connection_limit')).toBe('1');
  });

  /**
   * A schema name cannot be a bound parameter, so it is interpolated. Anything
   * that is not exactly the shape `TenantSlug.schemaName` produces is refused
   * before it reaches a connection string.
   */
  it.each([
    'public',
    'tenant_a; DROP SCHEMA public CASCADE',
    'tenant_UPPER',
    'tenant_with-hyphen',
    '../../etc',
    '',
    'tenant_' + 'x'.repeat(60),
  ])('refuses unsafe schema name %s', (name) => {
    expect(() => factory.forSchema(name)).toThrow(/unsafe schema name/);
    expect(factory.cachedSchemas).toEqual([]);
  });

  it('accepts the names TenantSlug actually generates', () => {
    expect(() => factory.forSchema('tenant_albazourieh')).not.toThrow();
    expect(() => factory.forSchema('tenant_deir_el_qamar')).not.toThrow();
  });
});
