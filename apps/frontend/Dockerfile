# syntax=docker/dockerfile:1
#
# Multi-stage build for the Next.js frontend, using `output: 'standalone'` so the
# runner carries only the traced dependencies rather than the whole workspace.

# ── deps ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/frontend/package.json apps/frontend/
COPY packages/shared-schemas/package.json packages/shared-schemas/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /repo/packages/shared-schemas/node_modules ./packages/shared-schemas/node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so the API URL must be present
# here rather than only in the runtime environment.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter @mechanization/shared-schemas build \
 && pnpm --filter @mechanization/frontend build

# ── runner ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001
USER nextjs

COPY --from=build --chown=nextjs:nodejs /repo/apps/frontend/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/frontend/public ./apps/frontend/public

EXPOSE 3000

CMD ["node", "apps/frontend/server.js"]
