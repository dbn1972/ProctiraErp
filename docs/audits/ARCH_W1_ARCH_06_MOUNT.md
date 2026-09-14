# W1-ARCH-06 — Gateway mount-matrix executable composition

**Finding:** Gateway mount-matrix tests scraped `domain-plugins.ts` source text and
did not prove executable composition/persistence. Medium, partial.

**Branch:** `cursor/aud-w1-arch-06-mount-matrix-56c3`  
**Date (UTC):** 2026-09-14

## Remediation

Prefer **live registrar exports + a booted gateway** over regex scraping of
source for composition truth.

### Changes

| Artifact | Role |
| --- | --- |
| `domain-plugins.ts` → `DOMAIN_REGISTRAR_COMPOSITION` | Executable name + `proxyPrefixes` snapshot |
| `gateway-mount-matrix.test.ts` | Uses `DOMAIN_REGISTRAR_NAMES` import (no registrar source scrape) |
| `arch06-mount-composition.test.ts` | Boots `buildApp`, probes every mounted matrix prefix, round-trips persistence |
| `GATEWAY_MOUNT_MATRIX.md` | Points at the executable composition suite |

### What the executable suite proves

1. **Composition** — every mounted `MOUNT_MATRIX` prefix answers an authenticated
   inject that is **not** Fastify’s “Route … not found” (route is registered).
2. **Live alignment** — `DOMAIN_REGISTRAR_COMPOSITION` / `DOMAIN_REGISTRAR_NAMES`
   match matrix registrar rows; live `proxyPrefixes` are covered by mounted rows
   (or `app.ts` direct mounts: auth / audit-logs / billing / tenant-lifecycle / providers).
3. **Persistence** — without `DATABASE_URL`, in-process stores round-trip for:
   - `custom-field` (matrix `in-memory`)
   - `privacy` (matrix `in-memory`)
   - `institution` academic-periods (matrix `prisma+rls` → memory fallback)
   - `fees` invoice path composed (matrix `raw-pg` → memory fallback; create may
     validate before persist depending on payload)

### Intentional residual (static)

W1-ARCH-05 **plugin-export allowlist** still scans `packages/backend/*/src`
for `fastify-plugin` / `fp(` exports. That gate cannot mount parked packages to
“prove” non-registration without composing them; ARCH-06 covers the mounted
composition path instead.

## Evidence

```bash
pnpm --filter @proctira/api-gateway exec vitest run \
  src/gateway-mount-matrix.test.ts \
  src/arch06-mount-composition.test.ts \
  src/arch05-compose-mount.test.ts
```

`arch05-compose-mount.test.ts` JWT includes `platform_admin` so privacy
(`platform` resource) and custom-fields compose smokes stay green under current RBAC.

## Residuals

| Residual | Status |
| --- | --- |
| Live Postgres persistence for raw-pg / prisma rows | **Out of scope** — ARCH-06 proves composition + in-process persistence without DB; PG paths remain covered by package live tests / P0-05 factory fail-closed |
| W1-ARCH-05 static plugin-export scrape | **Accepted** — export detection for unmounted packages |
| Probe path map for nested-only prefixes | **Maintained** in `PREFIX_PROBES` inside `arch06-mount-composition.test.ts` |

## Sign-off

**Architecture claim:** Mount-matrix composition is executable (booted gateway +
live registrar export). Source scrape of registrar names is removed.
