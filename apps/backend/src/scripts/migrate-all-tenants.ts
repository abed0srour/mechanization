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

/** Applies pending migrations to every provisioned schema, sequentially. */
export async function migrateAllTenants(): Promise<void> {
  const registry = new RegistryPrismaClient();
  const ddl = new Client({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  });

  const failures: Array<{ slug: string; error: string }> = [];

  try {
    await ddl.connect();

    /**
     * Bounded locks, because this loop runs against a live database.
     *
     * Without `lock_timeout`, an `ALTER TABLE` that cannot get its lock does
     * not fail — it waits, and every read of that table queues behind it. One
     * migration blocked on one open transaction is enough to stall a
     * municipality's portal for as long as the deploy is left running. Five
     * seconds turns that into a failed migration you retry, which is a far
     * better outcome than an outage nobody can attribute.
     *
     * `statement_timeout` is the outer bound on the DDL itself. Raise it via
     * the environment for a migration known to rewrite a large table, rather
     * than removing it.
     */
    await ddl.query(`SET lock_timeout = '${process.env.MIGRATION_LOCK_TIMEOUT ?? '5s'}'`);
    await ddl.query(
      `SET statement_timeout = '${process.env.MIGRATION_STATEMENT_TIMEOUT ?? '300s'}'`,
    );

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
