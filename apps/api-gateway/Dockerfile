# syntax=docker/dockerfile:1.7
# Dockerfile for the @proctira/api-gateway Fastify gateway.
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
# `build` runs `tsc --noEmit` which surfaces type errors at image-build time.
RUN pnpm --filter "@proctira/api-gateway..." run build

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache curl tini
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs fastify

# Copy the entire built workspace to preserve pnpm symlinks for module
# resolution. The image is still small because Alpine is lean.
COPY --from=builder --chown=fastify:nodejs /app ./

USER fastify
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
WORKDIR /app/apps/api-gateway
CMD ["node", "--enable-source-maps", "./node_modules/tsx/dist/cli.mjs", "src/server.ts"]
