# syntax=docker/dockerfile:1.7
# Development image for the whole monorepo (web, admin, api, db tooling). docker-compose.yml bind-mounts the source over /app
# for hot reload and keeps node_modules in named volumes; the `setup` service re-runs `pnpm install` so they follow the lockfile.
# Production runs on Vercel (see docs/DEPLOYMENT.md), this image is not meant for production.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS dev

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# corepack reads `packageManager` from package.json and fetches that exact pnpm version
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies first (cached until a manifest or the lockfile changes); workspace filters skip the root-only
# tooling (Playwright, Lighthouse) that the containers never use.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/content/package.json packages/content/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "./apps/*" --filter "./packages/*"

COPY . .
