-- Row Level Security: the real tenant boundary.
--
-- The application also injects `tenantId` into queries, but that is only a
-- second net. These policies mean a forgotten WHERE clause returns zero rows
-- instead of another municipality's citizens.
--
-- The app connects as a NON-superuser role that does not have BYPASSRLS.
-- Prisma sets `app.current_tenant_id` per transaction via set_config(...).

-- Helper: read the current tenant from the transaction-local setting.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

-- Apply to every tenant-scoped table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'municipality_users',
    'citizens',
    'registrations',
    'property_entries',
    'documents',
    'audit_log_entries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so the table owner is subject to the policy too.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())
    $f$, t);
  END LOOP;
END
$$;

-- The audit trail is append-only: no UPDATE or DELETE policy is ever created,
-- so even a SUPER_ADMIN cannot quietly rewrite their own history.
REVOKE UPDATE, DELETE ON audit_log_entries FROM PUBLIC;

-- Guard against a migration adding a tenant-scoped table without a policy.
COMMENT ON FUNCTION current_tenant_id() IS
  'Returns the tenant bound to the current transaction by the application. Any new tenant-scoped table must enable RLS and add a matching tenant_isolation policy.';
