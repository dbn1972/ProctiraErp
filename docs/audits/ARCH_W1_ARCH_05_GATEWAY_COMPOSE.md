# W1-ARCH-05 — Gateway domain plugin composition

**Finding:** Nine shipped backend packages remained outside active gateway composition.

**Branch:** `cursor/aud-w1-arch-05-gateway-compose-56c3`

## Remediation

Prefer wiring clear plugins + an allowlist/regression gate over mounting all nine blindly.

### Mounted (high-value)

| Package | Prefix | Notes |
| --- | --- | --- |
| `backend/custom-field` | `/custom-fields` | Definitions + values; in-memory |
| `backend/dashboards` | `/dashboards` | Unblocked by W1-ARCH-04 `AreaHierarchyResolver` |
| `backend/privacy` | `/privacy` | W1-SEC-06 legal hold + erasure HTTP (was missing from matrix) |

### Intentional non-goals (allowlisted)

`admin-dashboard`, `data-warehouse`, `install`, `plugin`, `policy`, `survey`, `theme` — each carries a parkedReason in `mount-matrix.ts` and is listed in `PLUGIN_EXPORT_ALLOWLIST`.

### CI gate

`apps/api-gateway/src/gateway-mount-matrix.test.ts` fails when a `packages/backend/*` package exports a Fastify plugin (`fastify-plugin` / `fp`) that is neither mounted nor allowlisted.

### Evidence

- Registrars: `custom-field`, `dashboards`, `privacy` in `domain-plugins.ts`
- Mount smoke: `arch05-compose-mount.test.ts`
- Matrix + allowlist: `mount-matrix.ts`, `GATEWAY_MOUNT_MATRIX.md`
