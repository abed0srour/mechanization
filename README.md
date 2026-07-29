## Setup

```bash
pnpm install
pnpm --filter @mechanization/shared-schemas build
pnpm db:generate

cp apps/backend/.env.example apps/backend/.env          
cp apps/frontend/.env.example apps/frontend/.env.local

pnpm db:seed
```

## Run everything at once

```bash
pnpm start
```

Starts Redis via Docker (skipped with a warning if Docker isn't running) then runs backend + frontend together.

## Run backend + frontend

```bash
pnpm dev     
```

- Backend only: `pnpm --filter @mechanization/backend dev`
- Frontend only: `pnpm --filter @mechanization/frontend dev`

## Run Redis (caching)

The backend caches dashboard/map data in Redis. It's optional — if `REDIS_URL` is unset or Redis is unreachable, reads fall through to Postgres.

```bash
docker compose up -d redis    
```

Make sure `apps/backend/.env` has:

```
REDIS_URL="redis://localhost:6379"
```

## Run everything with Docker

```bash
docker compose up --build
```

Postgres and storage are hosted on Supabase, so only Redis, backend, and frontend run locally. The backend won't accept traffic until Redis passes its healthcheck.

## Other commands

```bash
pnpm --filter @mechanization/backend test              
pnpm --filter @mechanization/backend tenant:provision --slug <slug> --name <name> --name-ar <name-ar> --prefix <prefix>
pnpm --filter @mechanization/backend cadastre:import --slug <slug> --file <path.kmz>
pnpm --filter @mechanization/backend tenant:migrate-all
pnpm lint
```
