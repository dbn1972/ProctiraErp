# W1-ARCH-09 — Production backend images must not execute TypeScript via tsx

**Finding:** Generic backend runtime images executed TypeScript source through `tsx` (`tsx/dist/cli.mjs` + `src/*.ts`). Medium, confirmed.

**Branch:** `cursor/aud-w1-arch-09-tsx-runtime-56c3`

## Remediation

Production Docker runners now boot **compiled JS** with Node:

| Image / Dockerfile | Production CMD |
| --- | --- |
| `Dockerfile.fastify-base` | `node --enable-source-maps ${OUTFILE}` (default `dist/server.js`) |
| `infrastructure/docker/Dockerfile.backend-service` | `node --enable-source-maps dist/standalone-server.js` |
| `infrastructure/docker/Dockerfile.api-gateway` | `node --enable-source-maps dist/server.js` |
| `infrastructure/docker/Dockerfile.etl-worker` | `node --enable-source-maps dist/server.js` |
| `apps/api-gateway/Dockerfile` | `node --enable-source-maps dist/server.js` |
| `apps/etl-worker/Dockerfile` | `node --enable-source-maps dist/server.js` |

### How `dist/` is produced

Workspace packages export TypeScript entrypoints and the shared tsconfig is `noEmit`, so a plain `tsc` emit graph is not Node-runnable. Builder stages call:

`tools/scripts/bundle-backend-runtime.mjs`

which esbuilds the service entry plus `@proctira/*` workspace sources into one ESM file under `dist/`, leaving third-party packages external.

Production `node` invocations also pass:

`--import /app/tools/scripts/backend-runtime-resolve.mjs`

so transitive deps declared only on workspace packages (e.g. `prom-client`, `@prisma/client`) still resolve under pnpm’s strict `node_modules` layout. This is a resolve hook, not TypeScript execution.

`@proctira/api-gateway` and `@proctira/etl-worker` `build` scripts run the bundler. Backend standalone images invoke the same script in `Dockerfile.backend-service`.

### Local / dev (tsx retained)

| Surface | Command | Notes |
| --- | --- | --- |
| `pnpm --filter @proctira/api-gateway dev` | `tsx watch src/server.ts` | Intentional |
| `pnpm --filter @proctira/etl-worker dev` | `tsx watch src/server.ts` | Intentional |
| `docker-compose.dev.yml` | `pnpm … dev` | HMR; no production image CMD |
| `start` scripts (gateway / etl-worker) | `node --import …/backend-runtime-resolve.mjs --enable-source-maps dist/server.js` | Requires prior `build` |

## Evidence

- No production Dockerfile `CMD`/`ENTRYPOINT` references `tsx` or `src/server.ts` / `src/standalone-server.ts` as the process entry.
- Bundle helper: `tools/scripts/bundle-backend-runtime.mjs`
- Resolve helper: `tools/scripts/backend-runtime-resolve.mjs` (+ hook)
- Local smoke: `node --import … dist/server.js` boots api-gateway (:3000), etl-worker (:3010), and institution standalone (:3020).
- Docs: `infrastructure/docker/README.md` (production vs local table)

## Residuals

1. **Image still copies full workspace** (including TypeScript sources and `tsx` in the install graph). Runtime no longer *executes* via tsx; slimming to a prod-only `node_modules` + `dist/` tree is a follow-up hardening (not required to close W1-ARCH-09).
2. **Backend package `build` scripts** remain `tsc --noEmit` for library packages; only gateway/etl-worker (and Docker standalone builds) emit `dist/`. A repo-wide emit/`exports` → `dist` migration is out of scope.
3. **Tip `tsc --noEmit` is red** on several shared/backend files (pre-existing on `main`); Docker builders no longer gate image build on that typecheck. CI `typecheck` remains the honesty path for types.
4. **Non-generic images** (Next.js apps, install-wizard, DR tools) were out of finding scope; unchanged.
5. **E2E / tenant-isolation / install-cli** still use `tsx` locally by design.
6. **Backend packages lack `"type":"module"`** — Node emits `MODULE_TYPELESS_PACKAGE_JSON` when loading `dist/*.js`; harmless with ESM syntax detection.
