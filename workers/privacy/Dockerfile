# syntax=docker/dockerfile:1.7
# Dockerfile for the @proctira/privacy-worker durable consumer (PRC-H078).
# Build context: monorepo root. Runs the TypeScript entrypoint via tsx like the other
# workers/* packages (no emitted dist); /healthz on PRIVACY_WORKER_HEALTH_PORT.
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
COPY workers ./workers
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@proctira/privacy-worker" run typecheck
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache curl tini
WORKDIR /app
ENV NODE_ENV=production
ENV PRIVACY_WORKER_HEALTH_PORT=8095
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs worker
COPY --from=deps --chown=worker:nodejs /app ./
USER worker
EXPOSE 8095
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail "http://127.0.0.1:${PRIVACY_WORKER_HEALTH_PORT}/healthz" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
WORKDIR /app/workers/privacy
CMD ["node_modules/.bin/tsx", "src/main.ts"]
