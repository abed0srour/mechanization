#!/usr/bin/env node
/**
 * Copies the Al-Bazourieh tenant data, users, auth credentials, and storage
 * from staging (lzgbjcwtzqyrbeoolvdz) to production (thbgwfbcqdougbjvgvyw).
 *
 * Runs inside GitHub Actions with the `db-production` environment secrets.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'apps', 'backend', 'package.json'));
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const TENANT_SLUG = 'albazourieh';
const SCHEMA_NAME = `tenant_${TENANT_SLUG}`;
const PROD_REF = 'thbgwfbcqdougbjvgvyw';
const STAGING_REF = 'lzgbjcwtzqyrbeoolvdz';

const MIGRATIONS_DIR = join(
  ROOT,
  'apps/backend/src/infrastructure/prisma/tenant/migrations',
);

const TABLES = [
  'zones',
  'users',
  'households',
  'parcels',
  'building_units',
  'registrations',
  'property_entries',
  'household_members',
  'documents',
  'field_visits',
  'field_assignments',
  'field_drafts',
  'fee_notices',
  'citizen_payments',
  'payment_transactions',
  'inspector_payouts',
  'expenses',
  'otp_challenges',
  'audit_log_entries',
  'system_settings',
];

function getRef(url) {
  if (!url) return null;
  const match = url.match(/postgres\.([a-z0-9]+):/i) || url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

async function main() {
  const confirmRef = process.env.CONFIRM_REF || process.argv.find((a) => a.startsWith('--confirm='))?.split('=')[1];
  const isDryRun = process.argv.includes('--dry-run');

  if (!confirmRef || confirmRef !== PROD_REF) {
    throw new Error(`Confirmation required. Expected --confirm=${PROD_REF}, got '${confirmRef}'`);
  }

  const stagingUrl = process.env.STAGING_DIRECT_URL || process.env.STAGING_DATABASE_URL;
  const prodUrl = process.env.PRODUCTION_DIRECT_URL || process.env.PRODUCTION_DATABASE_URL;

  if (!stagingUrl || !prodUrl) {
    throw new Error('STAGING_DIRECT_URL and PRODUCTION_DIRECT_URL must both be set.');
  }

  const stagingRef = getRef(stagingUrl);
  const prodRef = getRef(prodUrl);

  if (stagingRef !== STAGING_REF) {
    throw new Error(`Staging ref mismatch: expected ${STAGING_REF}, got ${stagingRef}`);
  }
  if (prodRef !== PROD_REF) {
    throw new Error(`Production ref mismatch: expected ${PROD_REF}, got ${prodRef}`);
  }

  console.log(`\n=============================================================`);
  console.log(`  Syncing '${TENANT_SLUG}' to PRODUCTION (${prodRef})`);
  console.log(`  Source: STAGING (${stagingRef})`);
  console.log(`  Mode:   ${isDryRun ? 'DRY RUN (no changes)' : 'APPLY'}`);
  console.log(`=============================================================\n`);

  const stagingClient = new Client({ connectionString: stagingUrl });
  const prodClient = new Client({ connectionString: prodUrl });

  await stagingClient.connect();
  await prodClient.connect();

  try {
    // 1. Check Staging Source Data
    const tenantRes = await stagingClient.query('SELECT * FROM public.tenants WHERE slug = $1', [TENANT_SLUG]);
    if (tenantRes.rows.length === 0) {
      throw new Error(`Tenant '${TENANT_SLUG}' not found in staging public.tenants!`);
    }
    const tenantRow = tenantRes.rows[0];
    console.log(`✓ Found tenant in staging: ${tenantRow.name} (${tenantRow.slug})`);

    if (isDryRun) {
      console.log('\n[Dry Run] Would apply migrations, copy tables, auth accounts, and storage.');
      return;
    }

    // 2. Sync public.tenants row
    console.log(`\n1. Upserting public.tenants row on production...`);
    const tenantCols = Object.keys(tenantRow);
    const tenantVals = Object.values(tenantRow);
    const tenantPlaceholders = tenantCols.map((_, i) => `$${i + 1}`).join(', ');
    const tenantColList = tenantCols.map((c) => `"${c}"`).join(', ');
    const tenantUpdateSet = tenantCols
      .filter((c) => c !== 'id' && c !== 'slug')
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');

    await prodClient.query(
      `INSERT INTO public.tenants (${tenantColList})
       VALUES (${tenantPlaceholders})
       ON CONFLICT (slug) DO UPDATE SET ${tenantUpdateSet};`,
      tenantVals,
    );
    console.log(`✓ Tenant registry row upserted on production.`);

    // 3. Ensure schema and run tenant migrations on production
    console.log(`\n2. Running tenant migrations for schema '${SCHEMA_NAME}' on production...`);
    await prodClient.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA_NAME}"`);
    await prodClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await prodClient.query(`
      CREATE TABLE IF NOT EXISTS "${SCHEMA_NAME}"."_tenant_migrations" (
        "name"      TEXT PRIMARY KEY,
        "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows: appliedRows } = await prodClient.query(
      `SELECT "name" FROM "${SCHEMA_NAME}"."_tenant_migrations"`,
    );
    const alreadyApplied = new Set(appliedRows.map((r) => r.name));

    const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of migrationDirs) {
      if (alreadyApplied.has(dir.name)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, dir.name, 'migration.sql'), 'utf8');

      await prodClient.query('BEGIN');
      try {
        await prodClient.query(`SET LOCAL search_path TO "${SCHEMA_NAME}"`);
        await prodClient.query(sql);
        await prodClient.query(
          `INSERT INTO "${SCHEMA_NAME}"."_tenant_migrations" ("name") VALUES ($1)`,
          [dir.name],
        );
        await prodClient.query('COMMIT');
        console.log(`  ✓ Applied migration: ${dir.name}`);
      } catch (err) {
        await prodClient.query('ROLLBACK');
        throw new Error(`Migration ${dir.name} failed on production: ${err.message}`);
      }
    }
    console.log(`✓ Tenant schema migrations up to date on production.`);

    // 4. Copy tenant table data
    console.log(`\n3. Copying tenant table data from staging to production...`);
    await prodClient.query("SET session_replication_role = 'replica';");

    for (const table of TABLES) {
      const sourceCountRes = await stagingClient.query(
        `SELECT count(*)::int as count FROM "${SCHEMA_NAME}"."${table}"`,
      );
      const count = sourceCountRes.rows[0].count;

      // Truncate target table
      await prodClient.query(`TRUNCATE TABLE "${SCHEMA_NAME}"."${table}" CASCADE;`);

      if (count > 0) {
        const sourceData = await stagingClient.query(`SELECT * FROM "${SCHEMA_NAME}"."${table}"`);
        const rows = sourceData.rows;

        // Batch insert
        const batchSize = 200;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const cols = Object.keys(batch[0]);
          const colList = cols.map((c) => `"${c}"`).join(', ');

          const valueStrings = [];
          const params = [];
          let paramIdx = 1;

          for (const row of batch) {
            const placeholders = [];
            for (const col of cols) {
              placeholders.push(`$${paramIdx++}`);
              params.push(row[col]);
            }
            valueStrings.push(`(${placeholders.join(', ')})`);
          }

          const insertSql = `INSERT INTO "${SCHEMA_NAME}"."${table}" (${colList}) VALUES ${valueStrings.join(', ')};`;
          await prodClient.query(insertSql, params);
        }
        console.log(`  ✓ ${table}: copied ${count} rows`);
      } else {
        console.log(`  · ${table}: 0 rows (empty)`);
      }
    }

    // Reset sequence
    const seqRes = await stagingClient.query(
      `SELECT last_value, is_called FROM "${SCHEMA_NAME}".payment_receipt_seq`,
    ).catch(() => ({ rows: [] }));
    if (seqRes.rows.length > 0) {
      const { last_value, is_called } = seqRes.rows[0];
      await prodClient.query(
        `SELECT setval('"${SCHEMA_NAME}".payment_receipt_seq', $1, $2)`,
        [last_value, is_called],
      );
      console.log(`  ✓ payment_receipt_seq synced to ${last_value}`);
    }

    await prodClient.query("SET session_replication_role = 'origin';");
    console.log(`✓ All tenant tables successfully copied.`);

    // 5. Migrate auth.users and auth.identities
    console.log(`\n4. Copying auth.users and auth.identities to production...`);
    const usersRes = await stagingClient.query('SELECT * FROM auth.users');
    console.log(`  Found ${usersRes.rows.length} users in staging auth.users`);

    for (const row of usersRes.rows) {
      delete row.confirmed_at; // generated column
      const cols = Object.keys(row);
      const vals = Object.values(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const updateSet = cols
        .filter((c) => c !== 'id')
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');

      await prodClient.query(
        `INSERT INTO auth.users (${colList})
         VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${updateSet};`,
        vals,
      );
    }
    console.log(`  ✓ ${usersRes.rows.length} users synced to production auth.users`);

    const identitiesRes = await stagingClient.query('SELECT * FROM auth.identities');
    console.log(`  Found ${identitiesRes.rows.length} identities in staging auth.identities`);

    for (const row of identitiesRes.rows) {
      delete row.email; // generated column
      const cols = Object.keys(row);
      const vals = Object.values(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const updateSet = cols
        .filter((c) => c !== 'id')
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');

      await prodClient.query(
        `INSERT INTO auth.identities (${colList})
         VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${updateSet};`,
        vals,
      );
    }
    console.log(`  ✓ ${identitiesRes.rows.length} identities synced to production auth.identities`);

    // 6. Copy Storage Files
    const stagingKey = process.env.STAGING_SERVICE_ROLE_KEY;
    const prodKey = process.env.PRODUCTION_SERVICE_ROLE_KEY;
    const stagingSupabaseUrl = process.env.STAGING_SUPABASE_URL || `https://${STAGING_REF}.supabase.co`;
    const prodSupabaseUrl = process.env.PRODUCTION_SUPABASE_URL || `https://${PROD_REF}.supabase.co`;

    if (stagingKey && prodKey) {
      console.log(`\n5. Syncing storage bucket 'cadastre'...`);
      const stagingSupabase = createClient(stagingSupabaseUrl, stagingKey);
      const prodSupabase = createClient(prodSupabaseUrl, prodKey);

      // Ensure bucket exists in prod
      const { data: buckets } = await prodSupabase.storage.listBuckets();
      if (!buckets?.some((b) => b.name === 'cadastre')) {
        await prodSupabase.storage.createBucket('cadastre', { public: true });
        console.log(`  ✓ Created bucket 'cadastre' on production.`);
      }

      const { data: files, error: listError } = await stagingSupabase.storage
        .from('cadastre')
        .list(TENANT_SLUG);

      if (listError) {
        console.warn(`  ! Could not list files from staging storage: ${listError.message}`);
      } else if (files && files.length > 0) {
        for (const file of files) {
          const filePath = `${TENANT_SLUG}/${file.name}`;
          const { data: blob, error: dlError } = await stagingSupabase.storage
            .from('cadastre')
            .download(filePath);

          if (dlError) {
            console.warn(`  ! Failed to download ${filePath}: ${dlError.message}`);
            continue;
          }

          const arrayBuffer = await blob.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          const { error: upError } = await prodSupabase.storage
            .from('cadastre')
            .upload(filePath, buffer, {
              upsert: true,
              contentType: file.metadata?.mimetype || 'application/geo+json',
            });

          if (upError) {
            console.warn(`  ! Failed to upload ${filePath} to production: ${upError.message}`);
          } else {
            console.log(`  ✓ Uploaded ${filePath} to production storage.`);
          }
        }
      }
    }

    // 7. Final Verification
    console.log(`\n=============================================================`);
    console.log(`  VERIFICATION SUMMARY`);
    console.log(`=============================================================`);
    const prodTenants = await prodClient.query('SELECT count(*)::int as count FROM public.tenants WHERE slug = $1', [TENANT_SLUG]);
    const prodParcels = await prodClient.query(`SELECT count(*)::int as count FROM "${SCHEMA_NAME}".parcels`);
    const prodUsers = await prodClient.query(`SELECT count(*)::int as count FROM "${SCHEMA_NAME}".users`);
    const prodAuthUsers = await prodClient.query('SELECT count(*)::int as count FROM auth.users');

    console.log(`  Tenant:         ${prodTenants.rows[0].count === 1 ? '✓ Present' : '✗ Missing'}`);
    console.log(`  Parcels:        ${prodParcels.rows[0].count} rows`);
    console.log(`  Tenant users:   ${prodUsers.rows[0].count} rows`);
    console.log(`  Auth accounts:  ${prodAuthUsers.rows[0].count} accounts`);
    console.log(`\n✓ Production database is ready and fully populated!`);
  } finally {
    await stagingClient.end().catch(() => {});
    await prodClient.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\n✗ Error: ${err.message}`);
  process.exit(1);
});
