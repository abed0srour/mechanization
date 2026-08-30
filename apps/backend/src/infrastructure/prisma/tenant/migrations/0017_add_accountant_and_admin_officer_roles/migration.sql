-- Adds ACCOUNTANT ("محاسب") and ADMINISTRATIVE_OFFICER ("موظف إداري") to StaffRole enum
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMINISTRATIVE_OFFICER';
