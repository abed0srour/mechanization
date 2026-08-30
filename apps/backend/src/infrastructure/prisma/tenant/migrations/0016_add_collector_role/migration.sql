-- Adds COLLECTOR ("جابي") role to StaffRole enum
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'COLLECTOR';
