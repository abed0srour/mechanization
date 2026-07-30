/**
 * Applies any pending tenant migrations to every provisioned municipality.
 *
 *   pnpm tenant:migrate-all
 *
 * This is the standing cost of schema-per-tenant, and the reason it is a script
 * rather than a manual checklist: a schema silently left a migration behind
 * shows up later as a runtime "column does not exist" for one municipality only,
 * which is a miserable thing to debug.
 *
 * Runs schemas sequentially. Deploys are rare, tenants are few, and a failure
 * part-way through should stop rather than race ahead into the next schema.
 */
import { Client } from 'pg';
import { PrismaClient as RegistryPrismaClient } from '../generated/registry-client';
import { migrateTenantSchema } from '../infrastructure/prisma/tenant-migrator';

export async function migrateAllTenants(): Promise<void> {
  const registry = new RegistryPrismaClient();
  const ddl = new Client({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  });

  const failures: Array<{ slug: string; error: string }> = [];

  try {
    await ddl.connect();

    const tenants = await registry.tenant.findMany({
      where: { provisionedAt: { not: null } },
      orderBy: { slug: 'asc' },
    });

    if (tenants.length === 0) {
      console.log('No provisioned tenants found — nothing to migrate.');
      return;
    }

    console.log(`Migrating ${tenants.length} tenant schema(s)…\n`);

    for (const tenant of tenants) {
      try {
        const { applied, skipped } = await migrateTenantSchema(ddl, tenant.schemaName, (m) =>
          console.log(m),
        );
        console.log(
          `${tenant.slug}: ${applied.length} applied, ${skipped.length} already present`,
        );
      } catch (error) {
        // Keep going so one broken schema does not hide the state of the rest;
        // the non-zero exit below still fails the deploy.
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ slug: tenant.slug, error: message });
        console.error(`${tenant.slug}: FAILED — ${message}`);
      }
    }
  } finally {
    await ddl.end().catch(() => undefined);
    await registry.$disconnect();
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} tenant schema(s) failed to migrate: ${failures
        .map((f) => f.slug)
        .join(', ')}`,
    );
  }

  console.log('\n✓ All tenant schemas up to date');
}

if (require.main === module) {
  migrateAllTenants().catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
