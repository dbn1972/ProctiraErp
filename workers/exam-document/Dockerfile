# syntax=docker/dockerfile:1.7
# Dockerfile for the @proctira/exam-document-worker durable worker.
# Build context: monorepo root.
# PRC-H051: packages the exam-document queue consumer with a health probe.
# W1-ARCH-09: production CMD uses compiled dist/main.js (not tsx).
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

FROM deps AS builder
ENV NODE_ENV=production
RUN pnpm --filter "@proctira/exam-document-worker" run build

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache curl tini
WORKDIR /app

ENV NODE_ENV=production
ENV EXAM_DOCUMENT_WORKER_PORT=3025
ENV EXAM_DOCUMENT_WORKER_HOST=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs fastify

COPY --from=builder --chown=fastify:nodejs /app ./

USER fastify
EXPOSE 3025

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail "http://127.0.0.1:${EXAM_DOCUMENT_WORKER_PORT}/health/ready" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
WORKDIR /app/workers/exam-document
CMD ["node", "--import", "/app/tools/scripts/backend-runtime-resolve.mjs", "--enable-source-maps", "dist/main.js"]
