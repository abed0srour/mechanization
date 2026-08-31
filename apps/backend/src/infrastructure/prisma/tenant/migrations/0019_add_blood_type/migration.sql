-- Add BloodType enum and column to users table across all tenant schemas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'BloodType' AND n.nspname = CURRENT_SCHEMA()
  ) THEN
    CREATE TYPE "BloodType" AS ENUM (
      'A_POSITIVE',
      'A_NEGATIVE',
      'B_POSITIVE',
      'B_NEGATIVE',
      'AB_POSITIVE',
      'AB_NEGATIVE',
      'O_POSITIVE',
      'O_NEGATIVE'
    );
  END IF;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "bloodType" "BloodType";
