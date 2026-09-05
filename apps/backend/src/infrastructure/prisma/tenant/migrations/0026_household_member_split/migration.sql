-- 0026_household_member_split
-- Splits familySize into totalRegisteredMembers (gross civil-registry count,
-- includes married children still listed on the family's إخراج قيد) and
-- actualHouseholdMembers (who actually lives in this household today), so
-- population analytics stop double-counting a married child once under their
-- parents and once under their own file. marriedChildrenCount is derived
-- (totalRegisteredMembers - actualHouseholdMembers) and never stored.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totalRegisteredMembers" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "actualHouseholdMembers" INTEGER;

-- No historical data distinguishes the two, so existing rows backfill as
-- 0 married children until staff correct them.
UPDATE "users"
   SET "totalRegisteredMembers" = "familySize",
       "actualHouseholdMembers" = "familySize"
 WHERE "familySize" IS NOT NULL
   AND "totalRegisteredMembers" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_household_members_check'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_household_members_check"
      CHECK (
        "actualHouseholdMembers" IS NULL
        OR "totalRegisteredMembers" IS NULL
        OR "actualHouseholdMembers" <= "totalRegisteredMembers"
      );
  END IF;
END $$;

ALTER TABLE "users" DROP COLUMN IF EXISTS "familySize";
