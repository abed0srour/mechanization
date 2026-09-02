-- Search that matches what a clerk actually types.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality. Both
-- functions and both columns therefore land *inside* each tenant schema, which
-- is also what lets `$queryRaw` and the Prisma query builder reach them
-- unqualified on a connection opened with `?schema=tenant_x`.
--
-- == What was wrong =========================================================
--
-- Four separate failures, all of which read to a clerk as "search is broken":
--
--  1. The citizens query matched against `first || ' ' || middle || ' ' || last`
--     as one string, so «أحمد نصرالله» — first name and family name, the way a
--     person is actually addressed — never matched anyone with a middle name.
--
--  2. The fees/payments query was worse. It ORed `firstName contains` against
--     `lastName contains` as separate clauses, so *any* two-word query matched
--     nothing at all: no single column contains both words, and no combination
--     of ORs can express "these two words, across these three columns".
--
--  3. Nothing was normalised. أحمد and احمد are the same name to every person
--     who has ever written it and two different strings to Postgres; the same
--     goes for ة/ه, ى/ي and every tashkeel mark. Arabic-Indic digits — what an
--     Arabic keyboard produces by default — never matched the Latin digits the
--     numbers are stored in.
--
--  4. Reference numbers are stored dashed (`BZR-2608-NZ58VK`). Read off a وصل
--     and typed as one run of characters, they matched nothing — even though
--     the citizen-facing login form has normalised exactly this shape since it
--     was written.
--
-- == The approach ===========================================================
--
-- One normalised, generated column per searchable table, and a query normalised
-- the same way before it is sent. Both sides of the comparison then live in the
-- same alphabet, which is the only way the four cases above collapse into one
-- rule instead of four special cases in two services.
--
-- Generated rather than trigger-maintained: `GENERATED ALWAYS AS ... STORED` is
-- the database's own guarantee that the column cannot drift from the row it
-- describes. A trigger has to be remembered by every future migration that
-- touches these tables, and a backfill that is skipped once leaves a
-- municipality quietly unsearchable.

-- == Normalisation ==========================================================

/*
  Folds a string to the alphabet searches are compared in.

  `translate` rather than a chain of `regexp_replace` because it is one pass
  over the string and because its truncation rule does the diacritic stripping
  for free: characters in `from` with no counterpart in `to` are deleted, so the
  tatweel and the tashkeel marks at the tail of the map simply vanish.

  The letter folds are the ones that change nothing about who a name refers to:
  the three hamza-carrying alefs and the bare alef are written interchangeably
  by hand, ة and ه are the same letter at a word's end for anyone typing
  quickly, and ى/ي is a keyboard difference rather than a spelling one.

  `[[:alnum:]]` is Unicode-aware in a UTF-8 database, so Arabic letters survive
  it and every separator — dash, plus, parenthesis, comma — collapses to a
  single space. That is what makes `BZR-2608-NZ58VK` and `bzr 2608 nz58vk` the
  same three tokens.
*/
CREATE OR REPLACE FUNCTION search_normalize(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT btrim(
    regexp_replace(
      translate(
        lower(coalesce(input, '')),
        -- Alef and hamza carriers, taa marbuta, alef maqsura.
        'أإآٱىةؤئ'
        -- Arabic-Indic digits, then the Extended (Persian/Urdu) set.
        || '٠١٢٣٤٥٦٧٨٩'
        || '۰۱۲۳۴۵۶۷۸۹'
        -- No counterpart below, so these are deleted: tatweel, then tashkeel.
        || 'ـًٌٍَُِّْٰ',
        'اااايهوي'
        || '0123456789'
        || '0123456789'
      ),
      '[^[:alnum:]]+', ' ', 'g'
    )
  );
$fn$;

/*
  The same fold with the spaces closed up.

  This is the form that catches an identifier dictated or copied without its
  separators — a reference number off a receipt, a phone number typed as one
  run. Stored *alongside* the spaced form rather than instead of it, because
  the spaced form is what multi-word name matching needs and the compact form
  is what identifier matching needs; a column holding both answers each with a
  plain substring test.
*/
CREATE OR REPLACE FUNCTION search_compact(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT replace(search_normalize(input), ' ', '');
$fn$;

-- == users ==================================================================

/*
  Everything a person can be looked up by, in one comparable column.

  The name parts are joined *before* normalising so they form one run of
  tokens: that is what makes «أحمد نصرالله» match أحمد خالد نصرالله, since each
  query token is tested against the whole column rather than against one field.

  Each identifier then appears twice — once inside that run, once compacted —
  and the identifiers are compacted individually rather than as a block so a
  query cannot match across the seam between a reference number and the phone
  that follows it.

  `email` is in here for the staff table, which searches the same column.
*/
ALTER TABLE "users"
  ADD COLUMN "searchText" TEXT
  GENERATED ALWAYS AS (
    search_normalize(
      coalesce("firstName", '') || ' ' ||
      coalesce("middleName", '') || ' ' ||
      coalesce("lastName", '') || ' ' ||
      coalesce("email", '') || ' ' ||
      coalesce("referenceNumber", '') || ' ' ||
      coalesce("phone", '') || ' ' ||
      coalesce("whatsapp", '') || ' ' ||
      coalesce("identityDocNumber", '') || ' ' ||
      coalesce("residencyNumber", '') || ' ' ||
      coalesce("civilRecordNumber", '')
    )
    || ' ' || search_compact("referenceNumber")
    || ' ' || search_compact("phone")
    || ' ' || search_compact("whatsapp")
    || ' ' || search_compact("identityDocNumber")
    || ' ' || search_compact("residencyNumber")
    || ' ' || search_compact("civilRecordNumber")
  ) STORED;

-- == citizen_payments =======================================================

/*
  The invoice's own searchable text. The payer is reached through
  `users."searchText"` across the join, so this holds only what belongs to the
  row itself: what the charge was for, and the Whish reference a citizen typed
  off their transfer receipt.
*/
ALTER TABLE "citizen_payments"
  ADD COLUMN "searchText" TEXT
  GENERATED ALWAYS AS (
    search_normalize(
      coalesce("title", '') || ' ' ||
      coalesce("whishTransactionRef", '')
    )
    || ' ' || search_compact("whishTransactionRef")
  ) STORED;

-- == Indexing ===============================================================
--
-- Deliberately none.
--
-- Every query against these columns is `LIKE '%token%'`, which no btree can
-- serve. The index that would is GIN over pg_trgm, and that extension is not
-- guaranteed present on the managed Postgres this deploys to — a migration
-- that fails to create it fails for a whole municipality, in order to speed up
-- a sequential scan over a registry of a few thousand rows that is already
-- well under a millisecond.
--
-- The point to add it is when one municipality's `users` passes roughly a
-- hundred thousand rows, and it is then one migration:
--
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE INDEX "users_searchText_trgm"
--     ON "users" USING gin ("searchText" gin_trgm_ops);
