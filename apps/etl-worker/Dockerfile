# syntax=docker/dockerfile:1.7
# Dockerfile for the @proctira/etl-worker service.
# Build context: monorepo root.
ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat curl tini
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY plugins ./plugins
COPY themes ./themes
COPY tools ./tools
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ENV NODE_ENV=production
RUN pnpm --filter "@proctira/etl-worker..." run build

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache curl tini
WORKDIR /app

ENV NODE_ENV=production
ENV ETL_WORKER_PORT=3010
ENV ETL_WORKER_HOST=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs fastify

COPY --from=builder --chown=fastify:nodejs /app ./

USER fastify
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail "http://127.0.0.1:${ETL_WORKER_PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
WORKDIR /app/apps/etl-worker
CMD ["node", "--enable-source-maps", "./node_modules/tsx/dist/cli.mjs", "src/server.ts"]
