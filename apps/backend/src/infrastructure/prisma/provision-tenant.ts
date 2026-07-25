/**
 * Provisions one municipality: registry row → Postgres schema → migrations.
 *
 *   pnpm tenant:provision --slug ashrafieh --name "Ashrafieh" --name-ar "الأشرفية" --prefix ASH
 *
 * Onboarding being an explicit, auditable command rather than an implicit
 * side-effect of inserting a row is deliberate. Someone should have to decide,
 * on purpose, that a new municipality's citizen data store now exists.
 *
 * Safe to re-run: schema creation, migrations and the registry upsert are all
 * idempotent, so a half-finished provision is fixed by running it again.
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { PrismaClient as RegistryPrismaClient } from '../../generated/registry-client';
import { TenantSlug } from '../../domain/value-objects/tenant-slug.vo';
import { migrateTenantSchema } from './tenant-migrator';

interface Args {
  slug: string;
  name: string;
  nameAr: string;
  prefix?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const slug = get('--slug');
  const name = get('--name');
  const nameAr = get('--name-ar');

  if (!slug || !name || !nameAr) {
    throw new Error(
      'Usage: tenant:provision --slug <slug> --name <name> --name-ar <arabic name> [--prefix ABC]',
    );
  }

  return { slug, name, nameAr, prefix: get('--prefix') };
}

/**
 * Obscure admin path segment. Scan-deterrence only — the guards are the actual
 * protection — so a short random suffix is enough and nothing depends on it
 * staying secret.
 */
function generateAdminPathSegment(): string {
  return `admin-portal-${randomBytes(3).toString('hex')}`;
}

export async function provisionTenant(args: Args): Promise<void> {
  const slug = TenantSlug.parse(args.slug);
  const schemaName = slug.schemaName;
  const referencePrefix = (args.prefix ?? args.name)
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');

  const registry = new RegistryPrismaClient();
  // DDL goes over the direct (session-mode) connection: schema and type creation
  // through a transaction pooler is unreliable.
  const ddl = new Client({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  });

  try {
    await ddl.connect();

    console.log(`Provisioning '${slug.value}' → schema '${schemaName}'`);

    const existing = await registry.tenant.findUnique({ where: { slug: slug.value } });
    if (existing && existing.schemaName !== schemaName) {
      // Rewriting this would orphan every row already written under the old name.
      throw new Error(
        `Tenant '${slug.value}' is already registered against schema '${existing.schemaName}'`,
      );
    }

    const tenant = await registry.tenant.upsert({
      where: { slug: slug.value },
      update: { name: args.name, nameAr: args.nameAr },
      create: {
        slug: slug.value,
        name: args.name,
        nameAr: args.nameAr,
        schemaName,
        adminPathSegment: generateAdminPathSegment(),
        referencePrefix,
        config: {},
        isActive: true,
      },
    });

    const { applied, skipped } = await migrateTenantSchema(ddl, schemaName, (m) => console.log(m));

    // Only now is the tenant servable — `Tenant.assertServable()` refuses
    // requests until this timestamp is set, so a failed migration above leaves
    // the municipality unreachable rather than half-built.
    await registry.tenant.update({
      where: { id: tenant.id },
      data: { provisionedAt: new Date() },
    });

    console.log(
      `\n✓ '${slug.value}' ready — ${applied.length} migration(s) applied, ${skipped.length} already present`,
    );
    console.log(`  admin path: /${slug.value}/ar/${tenant.adminPathSegment}`);
    console.log(`  reference prefix: ${tenant.referencePrefix}`);
  } finally {
    await ddl.end().catch(() => undefined);
    await registry.$disconnect();
  }
}

if (require.main === module) {
  provisionTenant(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(`\n✗ Provisioning failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
