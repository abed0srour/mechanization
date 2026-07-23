# Mechanization — Municipality Multi-Tenant Registration Platform

A multi-tenant platform for Lebanese municipalities (بلديات). Each municipality
is an isolated tenant with its own citizens, staff, dashboard, and audit trail,
served from one deployment.

- **Citizen wizard** (Arabic-first, RTL, elderly-accessible): registers a person
  and **any number of properties or units** they own or rent, with conditional
  fields per property type and one single multipart submission.
- **Staff portal** on a per-tenant unguessable path: JWT login, role-based
  access, report review workflow, deck.gl map.
- **Citizen accounts** without passwords: submitting the form *is* the account;
  returning citizens sign in with phone + SMS code.
- **Per-tenant audit trail**: append-only, redacted, readable only by SUPER_ADMIN.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces |
| Backend | NestJS, TypeScript, Clean Architecture / DDD |
| ORM | Prisma |
| Validation | Zod, shared between frontend and backend |
| Database | Supabase Postgres + Row Level Security |
| Citizen auth | Supabase Auth (phone OTP) |
| Staff auth | Passport-JWT, bcrypt, tenant-scoped claims |
| Storage | Supabase Storage, per-tenant paths |
| Frontend | Next.js App Router, TailwindCSS, deck.gl + MapLibre |

## Layout

```
apps/
  backend/          NestJS API — one folder per bounded context
    src/<context>/
      domain/          entities, value objects, repository *interfaces* (no framework imports)
      application/     use-cases, orchestration (no Prisma imports)
      infrastructure/  Prisma repos, Supabase adapters, Passport strategies
      presentation/    controllers, guards, Zod pipes
  frontend/         Next.js — /{municipality}/{locale}/...
packages/
  shared-schemas/   Zod schemas + Arabic labels used by BOTH sides
```

The layer rule is enforced, not aspirational — `domain/` and `application/`
typecheck with no Prisma and no NestJS in the graph.

## Getting started

### 1. Prerequisites
Node ≥ 20, pnpm, and a Supabase project (free tier is fine).

### 2. Install
```bash
pnpm install
```

### 3. Configure
```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
```
Fill in both. Generate the staff secret with `openssl rand -base64 48`.

> The service role key is server-side only. The frontend gets the anon key.

### 4. Database
```bash
pnpm db:generate
pnpm db:migrate      # includes the RLS policy migration
pnpm db:seed         # creates two municipalities + a SUPER_ADMIN in each
```

Seeding creates **two** tenants on purpose: if tenant isolation ever regresses,
the second municipality's data makes it obvious immediately.

### 5. Run
```bash
pnpm dev             # backend :4000, frontend :3000
```

Then open `http://localhost:3000/al-bazourieh/ar`.

## URL shape

| Path | Who |
|---|---|
| `/{municipality}/{locale}` | Landing — submit or track |
| `/{municipality}/{locale}/report` | Citizen wizard |
| `/{municipality}/{locale}/login` | Citizen phone + OTP |
| `/{municipality}/{locale}/my-account` | Citizen submissions + status |
| `/{municipality}/{locale}/{admin-path}/login` | Staff (path is per-tenant, seeded) |
| `/{municipality}/{locale}/dashboard` | Hard 404 — the guessable path is never used |

API mirrors this: `/api/v1/t/{municipality}/...`

## Tenant isolation

Three independent layers, in order of authority:

1. **Postgres RLS** — every tenant-scoped table has a `tenant_isolation` policy
   checking `tenant_id = current_tenant_id()`. `FORCE ROW LEVEL SECURITY` means
   the table owner is subject to it too. This is the real boundary.
2. **Transaction-bound tenant** — `PrismaService.withTenant()` sets
   `app.current_tenant_id` via `set_config(..., true)` so the setting is scoped
   to the transaction and cannot leak across pooled connections.
3. **Application scoping** — a Prisma client extension injects `tenantId` into
   queries, and `StaffAuthGuard` rejects a token whose `tenantId` does not match
   the municipality in the URL.

The audit table has no UPDATE or DELETE policy at all: it is append-only by
construction, so a SUPER_ADMIN cannot quietly rewrite their own history.

## Auth, and why it is split

Citizens and staff have opposite constraints, so they get different systems:

- **Citizens** are one-time or occasional users, often elderly, often on a shared
  household phone. A password is a barrier and a support burden. Supabase Auth
  phone OTP handles SMS delivery and verification; the backend only verifies the
  resulting JWT. Submitting the form creates the account — there is no separate
  sign-up. Because one phone can map to several people, a verified number that
  resolves to multiple profiles triggers a picker rather than a guess or a merge.
- **Staff** are trained repeat users with access to every citizen record in their
  municipality. They get email + password (bcrypt, 12 rounds), 12h JWTs, login
  throttled to 5/min, and roles scoped to their own tenant.

Every citizen also receives a **رقم مرجعي** — a reference number in a format that
excludes `I`, `O`, `0` and `1` so it survives being read aloud over the phone.

## Status

Working and verified:
- Shared Zod schemas with the full conditional taxonomy (tested)
- Domain entities with taxonomy + lifecycle invariants (16 assertions passing)
- Tenant resolution middleware, RLS migration, tenant-scoped Prisma
- Staff auth (login, JWT, guards, roles), citizen OTP bridge, audit trail
- Registration submit + per-tenant property-number uniqueness
- Frontend: landing, repeatable property step, citizen OTP login, staff login

Next up:
- Wizard steps 1, 2, 5, 6 (the repeatable property step is the reference pattern)
- Documents context: Supabase Storage adapter, magic-number sniffing
- Reporting context + deck.gl dashboard map
- Citizen account data wiring
