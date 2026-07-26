# Mechanization — Municipality Multi-Tenant Registration Platform

A multi-tenant platform for Lebanese municipalities (بلديات). Each municipality
is an isolated tenant with its own citizens, staff, dashboard and audit trail,
served from one deployment.

- **Citizen wizard** (Arabic-first, RTL, elderly-accessible): registers a person
  and **any number of properties or units** they own or rent, with conditional
  fields per property type, in one multipart submission. Progress is saved on
  the device at every step, so a dropped connection costs nothing.
- **رقم العقار is the location**: each municipality's cadastre is imported from
  the survey office's KMZ, so a parcel number is checked against the real
  registry as the citizen types — with the nearest real numbers offered when it
  is wrong — and the property's coordinates come from the survey rather than
  from a citizen dragging a pin.
- **Staff portal** on a per-tenant obscure path: JWT login, mandatory 2FA for
  `SUPER_ADMIN`, review workflow, MapLibre map, CSV export.
- **Citizen accounts** without passwords: submitting the form *is* the account;
  returning citizens sign in with phone + SMS code.
- **Per-tenant audit trail**: append-only at the database level, with identity
  fields redacted.

> **Before real citizen data touches this system**, read
> [`docs/open-decisions.md`](docs/open-decisions.md). Four items there are
> blocking, including the legal basis for holding refugee/displaced status and
> rotation of credentials that were shared in plain text.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces |
| Backend | NestJS, TypeScript, Clean Architecture / DDD (services, **no CQRS**) |
| ORM | Prisma — two generated clients, one per schema kind |
| Validation | Zod, shared between frontend and backend |
| Database | Supabase Postgres, **schema-per-tenant** |
| Auth | Self-hosted Passport-JWT — one issuer, one guard, citizens and staff |
| Storage | Supabase Storage, per-tenant path namespacing |
| Frontend | Next.js App Router, TailwindCSS, **plain MapLibre** |
| Cache | None. No Redis. |

### What changed from the v1 spec, and why

| v1 | v2 | Reason |
|---|---|---|
| CQRS command/query handlers | Plain services | Four classes per feature bought nothing while the read and write models are the same tables. |
| Shared schema + Postgres RLS | Schema-per-tenant | RLS keyed on `SET app.current_tenant_id` must be re-set on every request; behind pgbouncer a connection is reused, so a missed `SET` reads another municipality's rows *silently*. The schema is now part of the connection string. |
| Supabase Auth + separate staff JWT | One unified auth system | Two token formats meant every "does this token's tenant match" check was written twice — and a check written twice eventually exists once. |
| Redis | Nothing | Used for a cache with no measured need, a 10s cache over an indexed unique lookup, and rate-limit counters. Removed a whole service and a class of invalidation bugs. |
| deck.gl | Plain MapLibre markers | At a few hundred points its WebGL pipeline buys nothing, and its bundle works against the low-end-Android accessibility goal. |
| Citizen pin-drop / GPS location step | Coordinates from the cadastre | The survey office already knows where parcel 1553 is, to better precision than anyone achieves dragging a pin on a phone. The step could only produce a worse answer to a question already answered — and it took MapLibre off the citizen bundle entirely. |
| 2FA "worth considering" | 2FA mandatory for `SUPER_ADMIN` | That role can read and export every citizen's ID number and residency status. |

## Layout

```
apps/backend/src/
├── domain/           # entities, value objects, repository ports — zero framework imports
├── application/      # one service per bounded context, + events, pipes, jobs
├── infrastructure/   # the only layer that imports Prisma/Supabase/bcrypt
└── presentation/     # the only layer that knows HTTP
apps/frontend/        # Next.js App Router, /{tenant}/{locale}/...
packages/shared-schemas/   # Zod schemas + Arabic labels, shared FE/BE
docs/open-decisions.md     # what this codebase cannot decide for itself
```

## Multi-tenancy

One shared `public` schema holds only the tenant registry — no citizen data.
Every municipality gets its own Postgres schema (`tenant_albazourieh`,
`tenant_zahle`, …).

1. `TenantMiddleware` resolves `/t/:slug/…` against the registry.
2. `TenantPrismaFactory` returns a `PrismaClient` whose connection string
   contains `?schema=tenant_x`.
3. That client is put in an `AsyncLocalStorage` scope; every repository reads it
   from there. **No repository method takes a tenant argument**, so there is no
   parameter to fill in wrongly.
4. `JwtAuthGuard` rejects a token whose `tenantSlug` differs from the URL's.

Cross-tenant reads therefore require handing out the wrong client object —
visible in review — rather than forgetting a session variable.

## Getting started

```bash
pnpm install
pnpm --filter @mechanization/shared-schemas build   # backend imports its types
pnpm db:generate                                    # both Prisma clients

cp apps/backend/.env.example apps/backend/.env      # fill in
cp apps/frontend/.env.example apps/frontend/.env.local

pnpm db:seed        # 2 provisioned municipalities + staff + sample citizens

# Al Bazourieh's real parcel registry — 1,825 parcels from the survey office.
pnpm --filter @mechanization/backend cadastre:import \
  --slug albazourieh --file ../../bazoreyye.kmz

pnpm dev            # backend :4000, frontend :3000
```

Run the cadastre import **before** `db:seed` if you want the seeded sample
registrations to sit on real parcels — the seed adopts real parcel numbers
whenever the municipality has a cadastre, and falls back to synthetic ones
when it does not.

Seeded municipalities: `albazourieh` and `zahle`. Staff sign in with
`admin@<slug>.gov.lb` / `Password123!` — the seed prints the `SUPER_ADMIN` TOTP
secret, which is required because 2FA is mandatory for that role.

| | URL |
|---|---|
| Citizen wizard | <http://localhost:3000/albazourieh/ar> |
| Staff portal | <http://localhost:3000/albazourieh/ar/admin-portal-a91f/login> |

The staff path segment is per-tenant and unguessable; the seed prints it, and
`/albazourieh/ar/dashboard` is hard-404'd rather than redirected — a redirect
would confirm the portal exists.

### Onboarding a municipality

```bash
pnpm --filter @mechanization/backend tenant:provision \
  --slug deir-el-qamar --name "Deir el Qamar" --name-ar "دير القمر" --prefix DQM
```

Creates the registry row, creates the Postgres schema, applies every tenant
migration, then marks the tenant servable. Idempotent — safe to re-run.

### Importing a cadastre

```bash
pnpm --filter @mechanization/backend cadastre:import \
  --slug albazourieh --file ../../bazoreyye.kmz
```

Reads the survey office's KMZ (a ZIP holding one KML) and writes two things:

1. **`parcels` rows** in that municipality's schema — the registry رقم العقار is
   validated against, and the source of every registration's coordinates.
2. **`apps/frontend/public/tenants/<slug>/{parcels,cadastre}.geojson`** — the
   parcel grid and numbers the staff map draws under the registration markers.
   Cartography rather than queryable data, so a cacheable static file beats a
   table and an endpoint.

Idempotent: the parcel table is rebuilt from the file on every run, so a
corrected export is applied by re-running rather than by patching rows.

Label points sharing a parcel number are merged to their centroid — the survey
draws a second label where a parcel is split — and those parcels are flagged
`pointCount > 1` so the form can tell the citizen the location is approximate
instead of implying a precision the data does not have.

**A municipality with no cadastre keeps the old behaviour**: any well-formed
parcel number is accepted and no coordinates are recorded. Onboarding a tenant
therefore does not have to wait on their survey office — `zahle` is seeded this
way on purpose, so the fallback path is exercised in development rather than
discovered in production.

## The staff map

`/{tenant}/{locale}/{adminPath}/map` — a fullscreen cadastral map, reached from
the **فتح الخريطة الكاملة** button on the dashboard toolbar.

Three things are layered, and the distinction between them is the point:

| Layer | Source | Interactive |
|---|---|---|
| Basemap — satellite / light / dark | Esri imagery, CARTO raster | switcher, bottom-centre |
| The whole cadastre: ~1,800 parcel outlines + numbers | static GeoJSON | no |
| A dot per parcel that has registrations | `GET /dashboard/map/parcels` | yes |

**A dot is never drawn on an unregistered parcel.** With 1,825 parcels and (in
development) six registered, a marker on every one would be 1,819 dots that mean
nothing. A visible dot is therefore a promise that there is a citizen record
behind it; a parcel carrying more than one registration is drawn larger and
labelled with the count, because co-ownership is what staff most need to spot.

Clicking a dot opens a left-anchored drawer listing everyone on that parcel —
name, صفة (مالك/مستأجر), status, registration date, phone — each with a link
through to `/{tenant}/{locale}/{adminPath}/citizens/{id}`.

### Why parcels can have several registrants

`property_entries.propertyNumber` is deliberately **not unique** (migration
`0004_parcel_co_registration`). An apartment building is one cadastral number
shared by every owner and tenant inside it. The unique index meant the second
resident to register was told their own address was "already registered" and
could not file at all — so the constraint was not protecting data, it was
losing it. The citizen form now reports neighbours as reassurance
("مسجّل ٣ أشخاص آخرين على هذا العقار — هذا طبيعي في المباني المشتركة") instead
of refusing the entry, and overlapping claims are surfaced to staff on the map
rather than prevented at the keyboard.

### Why the citizen page is not at `/citizens/{id}`

It is at `/{tenant}/{locale}/{adminPath}/citizens/{id}`. A bare id says nothing
about *which municipality's* schema to read — in this system the tenant boundary
is the database connection, not a `WHERE` clause — and the page renders identity
document numbers and residency status, which belong behind the same obscure
staff path and role guard as the rest of the portal. The API mirrors this:
`GET /t/:slug/citizens/:id`, with no un-scoped route.

### Adding a migration

Schema-per-tenant means migrations apply once **per municipality**:

```bash
# generate the delta into src/infrastructure/prisma/tenant/migrations/000N_<name>/
prisma migrate diff \
  --from-schema-datamodel <previous schema.prisma> \
  --to-schema-datamodel   apps/backend/src/infrastructure/prisma/tenant/schema.prisma \
  --script > .../migration.sql

pnpm --filter @mechanization/backend tenant:migrate-all
```

Each schema tracks what it has applied in its own `_tenant_migrations` table, so
a schema is self-describing rather than trusting a central ledger.

## Testing

```bash
pnpm --filter @mechanization/backend test
```

81 tests, no database required. The domain layer is pure, so its rules test
without mocks — which is the point of keeping the taxonomy in entities rather
than in a repository. `presentation/guards/tenant-isolation.spec.ts` and
`infrastructure/prisma/tenant-prisma.factory.spec.ts` cover the isolation
property from both sides: a valid tenant-A token is rejected on a tenant-B URL,
and the client cache never crosses schemas.

## Docker

```bash
docker compose up --build     # backend :4000, frontend :3000
```

Two services only — Postgres and storage are hosted, and there is no Redis.
Nothing in the compose file is a data store.
