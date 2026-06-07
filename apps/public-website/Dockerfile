# syntax=docker/dockerfile:1.7
# Dockerfile for the @proctira/public-website Next.js application.
# Build context: monorepo root.
ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat curl
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
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm --filter "@proctira/public-website..." run build

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache curl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3003
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/public-website/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/public-website/.next/static ./apps/public-website/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/public-website/public ./apps/public-website/public

USER nextjs
EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail "http://127.0.0.1:${PORT}/api/health" || exit 1

WORKDIR /app/apps/public-website
CMD ["node", "server.js"]
