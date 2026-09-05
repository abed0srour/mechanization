# Database environments

Two Supabase projects, three targets, and a set of checks whose only job is to
make "I ran it against the wrong one" impossible rather than unlikely.

| Target | Supabase project | Env file | Who runs it |
| --- | --- | --- | --- |
| `local` | `lzgbjcwtzqyrbeoolvdz` (staging) | `apps/backend/.env` | `pnpm dev` on a laptop |
| `staging` | `lzgbjcwtzqyrbeoolvdz` | `apps/backend/.env.staging` | GitHub Actions, on push to `develop` |
| `production` | `thbgwfbcqdougbjvgvyw` | `apps/backend/.env.production` | GitHub Actions, manual, with approval |

`local` and `staging` are the same database. There is no local Postgres —
`docker-compose.yml` runs Redis and nothing else — so "local" describes where
the *process* runs, not where the data lives. `pnpm dev` writes to staging.

The refs above are pinned in [`scripts/db/targets.mjs`](../scripts/db/targets.mjs).
Refs are not secrets; the passwords they pair with are, and those stay in
ignored dotenv files and GitHub Environment secrets.

---

## 1. The commands

```bash
pnpm db:check                 # validate every env file present. No network.
pnpm db:test                  # unit-test the guard itself
pnpm db:status:staging        # what is pending on staging, applies nothing
pnpm db:status:production     # same for production
pnpm db:deploy:staging        # apply
pnpm db:deploy:production     # apply, after typing the project ref
```

Every one of them names its target. There is deliberately no bare `db:deploy`
that reads ambient configuration and guesses.

Authoring a migration is unchanged:

```bash
pnpm db:migrate               # registry: prisma migrate dev --create-only
pnpm db:migrate:tenant        # tenant:  prisma migrate dev --create-only
```

---

## 2. What stops a mistake

Six checks, each one there because of a specific way this goes wrong.

**The env file must belong to the project the target is pinned to.** Both
connection strings and `SUPABASE_URL` are parsed, the project ref is extracted,
and a mismatch is a hard failure. Editing a dotenv file can no longer change
which database a command reaches — only naming a different target can.

**A non-production env file may not mention the production ref at all**, not
even in a comment. This catches the half-finished edit, where `DATABASE_URL` was
swapped but the service-role key below it was not.

**`pnpm dev` runs the check before it boots.** The moment someone pastes a
production connection string into `apps/backend/.env` — to read one row, to
reproduce one bug — the dev server stops starting instead of quietly attaching
the whole application to live data.

**Irreversible DDL blocks the deploy.** Pending migrations are scanned for
`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ALTER COLUMN … TYPE` and `RENAME`.
Those refuse to run without `--allow-destructive`. Statements that merely take a
heavy lock — `SET NOT NULL`, a non-concurrent `CREATE INDEX` — print a warning
and continue.

**Production only accepts migrations staging has already applied.** The deploy
reads staging's migration history and refuses anything staging has not seen.
This is what turns "we have a staging environment" into "staging is
load-bearing".

**Production needs the ref typed out.** Interactively, you type it at a prompt;
in CI, `--confirm=<ref>` must match, so a command copied from the staging
runbook cannot fire at production.

None of this is a substitute for reading the SQL. It is a floor, not a ceiling.

---

## 3. The normal path

```
feature branch
    ↓  pnpm db:migrate            author the migration
    ↓  pnpm dev                   it runs against staging, locally
  PR → develop
    ↓  CI: typecheck · test · db:test
  merge to develop
    ↓  Actions: Deploy staging     (automatic)
  PR → main, merge                 ships code only — no SQL runs
    ↓  Actions: Deploy production  (manual, dry run first, then approved)
```

Merging to `main` deliberately does not migrate production. Shipping code and
rewriting a database of citizen records are different decisions, and a branch
protection rule is a poor place to conflate them.

### Deploying production

1. `pnpm db:status:production` locally, or run the workflow with **dry run**
   ticked. Read the list of migrations it prints.
2. Confirm a backup exists — see §5.
3. Actions → **Deploy production** → Run workflow. Type the ref, leave
   `dry_run` on for the first run, then run again with it off.
4. A reviewer approves the `production` environment.
5. Afterwards: `curl https://<api>/api/v1/health/ready` should return
   `{"status":"ready"}`.

---

## 4. Schema changes that cannot lose data

The scanner blocks destructive DDL; this is the discipline that means you rarely
need to unblock it. It is the **expand/contract** pattern (also called parallel
change), and it is the standard answer to schema changes on a live database.

A rename, done wrong, is one migration: `ALTER TABLE … RENAME COLUMN a TO b`.
Between that statement committing and the new code being live, every running
instance is querying a column that no longer exists. Done right it is three
releases:

**Expand** — add the new thing, change nothing about the old. Add column `b` as
nullable. The running application does not know it exists, and nothing breaks.

**Migrate** — backfill `b` from `a` in batches, and deploy code that writes to
both and reads from `b` with a fallback to `a`. Both shapes are now correct, so
a rollback at any point is just a redeploy.

**Contract** — a release later, once nothing reads `a` and you have watched it
in production for a bake period, drop `a`. This is the one migration that runs
with `--allow-destructive`, and by then the flag is an accurate description of a
deliberate act rather than a way past an error message.

The same three steps cover retyping a column, splitting a table, and making a
column `NOT NULL` (add the constraint `NOT VALID`, backfill, then `VALIDATE`,
which takes a far weaker lock).

Two further rules for this codebase specifically:

- **Indexes on tenant tables want `CREATE INDEX CONCURRENTLY`.** A plain
  `CREATE INDEX` holds a write lock, and `tenant:migrate-all` runs it once per
  municipality in sequence. Note that `CONCURRENTLY` cannot run inside a
  transaction, and `tenant-migrator.ts` wraps each migration in one — so an
  index built this way needs its own migration containing nothing else, and the
  transaction wrapper adjusted for it. That is a real limitation, not a
  formality.
- **Migrations are immutable once merged.** Prisma records a checksum; editing
  an applied migration makes every environment that already ran it fail. Fix
  forward with a new migration.

### Rollback

There are no down-migrations here, by design. A down-migration is code that has
never run, being asked to work on the worst day. The rollback plan is:

- **Bad code, good schema** — redeploy the previous build. This works because
  expand/contract keeps the schema compatible with the release before it.
- **Bad schema** — write a forward migration that corrects it.
- **Data loss** — restore. See below.

---

## 5. Backups

Supabase takes daily backups on Pro and above; Point-in-Time Recovery is a paid
add-on that lets you restore to a specific second. **Check which of these the
production project actually has before the first production deploy** — the
difference between "yesterday" and "thirty seconds before the migration" is the
difference between a bad afternoon and a lost day of municipal records.

Dashboard → `thbgwfbcqdougbjvgvyw` → Database → Backups.

For a migration that rewrites data rather than only adding to the schema, take a
manual backup immediately before, regardless of what the plan provides.

---

## 6. Secrets

| Where | What |
| --- | --- |
| `apps/backend/.env` | Staging credentials. Gitignored. |
| `apps/backend/.env.staging` | Staging credentials. Gitignored. |
| GitHub → Environments → `db-staging` | `STAGING_DATABASE_URL`, `STAGING_DIRECT_URL`, `STAGING_SUPABASE_URL`, `STAGING_SERVICE_ROLE_KEY` |
| GitHub → Environments → `db-production` | The same four, `PRODUCTION_`-prefixed, **plus** the four `STAGING_` ones (the promotion check reads staging's history), plus required reviewers |

The `db-` prefix is not decoration. The Vercel integration creates its own
environments in this repository — `Production – mechanization-api`,
`Preview – mechanization-web` and so on — which report the status of *code*
deployments. These two gate *database migrations*. **Do not add protection
rules to the Vercel-created ones**: a required reviewer there starts holding
every site deploy for approval, which is not what anyone intended and is
confusing to diagnose.

There is no `apps/backend/.env.production`, and on a working laptop there should
not be one. A copy of the production database password on a developer's disk is
a credential with no expiry, no audit trail and no revocation path. The
break-glass procedure, for when CI is down and production is broken, is written
at the top of [`.env.production.example`](../apps/backend/.env.production.example) —
including the step everyone forgets, which is deleting the file afterwards.

`JWT_SECRET` **must differ between staging and production.** Sharing it means a
token minted by staging is accepted by production.

### Vercel

The deployed API reads its configuration from Vercel's environment variables,
not from anything in this repository or in GitHub secrets. That is a third
surface, and it is the one that decides which database real traffic reaches.

Every variable on `mechanization-api` used to be scoped `[production, preview]`,
which meant every pull-request preview deployment read and wrote the production
database. These five are now split, and must stay split:

| Variable | Production scope | Preview scope |
| --- | --- | --- |
| `DATABASE_URL` | `thbgwfbcqdougbjvgvyw` | `lzgbjcwtzqyrbeoolvdz` |
| `DIRECT_URL` | `thbgwfbcqdougbjvgvyw` | `lzgbjcwtzqyrbeoolvdz` |
| `SUPABASE_URL` | `thbgwfbcqdougbjvgvyw` | `lzgbjcwtzqyrbeoolvdz` |
| `SUPABASE_SERVICE_ROLE_KEY` | production key | staging key |
| `JWT_SECRET` | production secret | staging secret |

When adding any new variable that names a database, a bucket or a signing
secret, scope it to one environment. Ticking both boxes is the same mistake as
pointing `.env` at production — and unlike that one, no script here can catch
it, because Vercel's configuration is not visible from the repository.

Still shared, and lower stakes but not zero: `CORS_ORIGINS`, `PUBLIC_API_URL`,
`PUBLIC_PORTAL_URL`, `CRON_SECRET`. On `mechanization-web`,
`NEXT_PUBLIC_API_URL` is also shared, so preview builds of the portal call the
production API.

---

## 7. Sources

The practices above are the common industry ones, not invented here:

- [Managing Environments — Supabase](https://supabase.com/docs/guides/deployment/managing-environments)
  — separate projects per environment, migrations applied by CI, one-directional
  flow local → staging → production.
- [Expand and Contract](https://www.tim-wellhausen.de/papers/ExpandAndContract/ExpandAndContract.html)
  and [Parallel Change](https://medium.com/@jasminfluri/expand-and-contract-method-for-database-changes-414d236f236f)
  — the three-release pattern in §4.
- [Deploying database changes with Prisma Migrate](https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate)
  — `migrate deploy` in CI, never `migrate dev`; immutable migration history.
- [Zero-downtime schema migrations in PostgreSQL](https://medium.com/@antoniodipinto/zero-downtime-schema-migrations-in-postgresql-c138017e7f90)
  — `lock_timeout` and `statement_timeout` on migration sessions, `NOT VALID`
  then `VALIDATE`, `CREATE INDEX CONCURRENTLY`.
