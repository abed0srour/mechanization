import { Client } from 'pg';
import { PrismaClient as RegistryPrismaClient } from '../generated/registry-client';

async function run() {
  const registry = new RegistryPrismaClient();
  const db = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });

  try {
    await db.connect();
    const tenants = await registry.tenant.findMany({
      where: { provisionedAt: { not: null } },
      orderBy: { slug: 'asc' },
    });

    console.log(`Found ${tenants.length} provisioned tenant(s). Resetting 2FA...`);

    for (const tenant of tenants) {
      const res = await db.query(
        `UPDATE "${tenant.schemaName}"."users" SET "totpSecret" = NULL, "totpConfirmedAt" = NULL, "lastTotpStep" = NULL WHERE kind = 'STAFF'`,
      );
      console.log(`Tenant '${tenant.slug}': 2FA reset on ${res.rowCount} staff accounts.`);
    }
    console.log('All 2FA credentials successfully reset across all tenants!');
  } finally {
    await db.end().catch(() => undefined);
    await registry.$disconnect();
  }
}

run().catch((e) => {
  console.error('Failed to reset 2FA:', e);
  process.exit(1);
});
