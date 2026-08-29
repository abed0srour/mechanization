# Deploying to Vercel

Two projects, one repository. The frontend is a stock Next.js deployment; the
backend is the NestJS app running as a single serverless function.

| Project | Root Directory | Serves |
| --- | --- | --- |
| `mechanization-web` | `apps/frontend` | The portal and the admin UI |
| `mechanization-api` | `apps/backend` | `/api/v1/**` |

Both read a `vercel.json` in their own root directory, so install and build
commands are already set — do not override them in the dashboard.

---

## 1. Create the API project

1. **Add New → Project**, import `abed0srour/mechanization`.
2. **Root Directory**: `apps/backend`. Tick **Include source files outside of
   the Root Directory** — the backend depends on `@mechanization/shared-schemas`
   through the workspace, and without this the install has nothing to link.
3. Leave Framework Preset as **Other**. `vercel.json` supplies the rest.
4. Add the environment variables below, then deploy.

### API environment variables

Set all of these for **Production** and **Preview**.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **pooled** URL, port `6543`, with `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Supabase **direct** URL, port `5432` |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key. Never in the web project. |
| `SUPABASE_STORAGE_BUCKET` | `documents` |
| `JWT_SECRET` | ≥32 chars. `openssl rand -base64 48` |
| `JWT_STAFF_TTL` | `12h` |
| `JWT_STAFF_REMEMBER_TTL` | `30d` |
| `JWT_CITIZEN_TTL` | `7d` |
| `OTP_ENABLED` | `true` — production refuses to boot without it |
| `SMS_PROVIDER_API_KEY` | Required in production |
| `SMS_PROVIDER_FALLBACK_API_KEY` | Required in production (see `open-decisions.md` #2) |
| `CORS_ORIGINS` | The web project's origin, e.g. `https://mechanization-web.vercel.app` |
| `PUBLIC_API_URL` | This project's origin + `/api/v1` |
| `PUBLIC_PORTAL_URL` | The web project's origin |
| `CRON_SECRET` | `openssl rand -hex 32` — see §4 |

`connection_limit=1` is not a typo. Every warm instance holds its own pool, and
the tenant factory opens a further client per municipality it has served; the
pooler's connection budget is the first thing this deployment will run out of.

Leave `REDIS_URL` **unset** unless you have a serverless-friendly Redis
(Upstash over `rediss://`). The cache falls back to an in-process map, which on
serverless means a per-instance cache with a short life — correct, just less
effective. A plain `redis://` pointing at a container will simply fail to
connect on every cold start.

---

## 2. Create the web project

1. **Add New → Project**, import the same repository.
2. **Root Directory**: `apps/frontend`, again with **Include source files
   outside of the Root Directory** ticked.
3. Framework Preset: **Next.js**.

### Web environment variables

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | The API project's origin + `/api/v1` |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Your own token — the checked-in fallback is a personal one |

Both are inlined into the browser bundle at build time. Changing either needs a
redeploy, not a restart. Neither may ever hold a secret.

**Order matters**: deploy the API first, take its URL, then set
`NEXT_PUBLIC_API_URL` and `CORS_ORIGINS` from the two real origins and redeploy
both.

---

## 3. How the backend runs as a function

`apps/backend/api/index.js` is the entry point Vercel invokes. It requires
`dist/presentation/serverless.js`, which boots the Nest app once per warm
instance and hands back the Express instance the platform then calls.

Two details that are easy to undo by accident:

- **`api/index.js` is JavaScript, and thin, on purpose.** Vercel compiles files
  under `api/` with esbuild, which strips types without emitting the decorator
  metadata Nest's injector reads at runtime. Pointing that file at TypeScript
  sources produces an app whose every constructor argument is `undefined`. The
  real build is `nest build` (tsc, `emitDecoratorMetadata`); the entry file only
  requires its output, via a static path the dependency tracer can follow.
- **`binaryTargets` includes `rhel-openssl-3.0.x`** in both Prisma schemas. The
  query engine is a platform-specific binary; without the deployment target the
  build succeeds and the first query fails.

The rewrite in `vercel.json` sends everything the filesystem does not answer to
that one function. The app keeps its own `api/v1` global prefix, so the live
routes are unchanged from local: `https://<api>/api/v1/health`.

---

## 4. Scheduled jobs

`ScheduleModule` is skipped when `VERCEL` is set (`app.module.ts`). It cannot
work there: the instance holding the timer is torn down moments after the
response, so a registered `@Cron` would never fire while looking perfectly
healthy in the logs.

The two jobs are reachable over HTTP instead, through
`InternalCronController`, and `vercel.json` schedules them:

| Job | Route | Schedule |
| --- | --- | --- |
| OTP challenge prune | `GET /api/v1/internal/cron/otp-cleanup` | hourly |
| Recurring billing | `GET /api/v1/internal/cron/recurring-billing` | daily, 02:00 UTC |

Vercel sends `Authorization: Bearer $CRON_SECRET` on every invocation. **The
routes refuse to run at all when `CRON_SECRET` is unset** — a missing variable
closes the door rather than opening it, because these walk every municipality
and issue invoices.

Two caveats:

- **Hobby plans** allow two cron jobs and run each once a day regardless of the
  expression. The OTP prune becoming daily is tolerable (challenges expire in
  five minutes and are checked on use); billing is daily by design.
- **02:00 UTC is 05:00 in Beirut** in summer. Vercel cron expressions are UTC.

Docker and `pnpm dev` are unaffected: `VERCEL` is unset there, so the in-process
schedule still runs, and the endpoints are simply an extra way in.

---

## 5. Known limitations of this deployment

These are real behaviour changes, not warnings to skim.

1. **Cadastre import will fail.** `POST /t/:slug/cadastre/import` writes the
   generated map layers to `apps/frontend/public/tenants/<slug>/`. Vercel's
   filesystem is read-only, so the write throws. Run it locally instead —
   `pnpm --filter @mechanization/backend cadastre:import --slug <slug> --file <path.kmz>`
   — and commit the resulting files; the frontend serves them statically anyway.
   Moving those assets to Supabase Storage is the fix that removes the caveat.
2. **Uploads are capped at ~4.5 MB** by the platform's request-body limit,
   below `APP_CONFIG.cadastre.maxFileSizeBytes` (15 MB). Document uploads are
   well under it; a cadastre KMZ may not be. See (1).
3. **Rate limiting is per instance.** `ThrottlerModule` stores counters in
   memory, so the effective limit is roughly `configured × concurrent
   instances` — the staff-login and OTP limits are the ones that matter. A
   shared store (Redis) is the fix; until then, treat the numbers in
   `APP_CONFIG.throttle` as a floor, not a ceiling.
4. **Cold starts are slow.** A cold instance boots the whole Nest graph and
   connects the registry Prisma client before it answers anything — expect a
   couple of seconds on the first request after idle.
5. **Migrations are not run by the deploy.** `prisma migrate deploy` and
   `tenant:migrate-all` are still manual, from a machine with `DIRECT_URL`:

   ```bash
   pnpm --filter @mechanization/backend prisma:deploy:registry
   pnpm --filter @mechanization/backend tenant:migrate-all
   ```

---

## 6. After the first deploy

```bash
curl https://<api>/api/v1/health          # {"status":"ok",...}
curl https://<api>/api/v1/health/ready    # {"status":"ready"} — proves the DB is reachable
```

`degraded` on the second means `DATABASE_URL` is wrong or the pooler is
refusing connections; the build succeeding tells you nothing about either.

Then open the web project and sign in. If the browser console shows a CORS
failure, `CORS_ORIGINS` on the API does not contain the web origin exactly
(scheme included, no trailing slash).
