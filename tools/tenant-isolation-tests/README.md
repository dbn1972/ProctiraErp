# @proctira/tenant-isolation-tests

Multi-tenant isolation verification gate for the ProctiraERP Unified Platform.

This package implements **Charter Section 39 (Tenant Isolation Verification)**
and is a **release gate**: any cross-tenant data leak detected here MUST
fail CI and block the release.

## Coverage

The suite is split into seven categories. Each category is independently
runnable so service teams can debug a single failing facet without running
the entire gate locally.

| Category                     | Location           | Script                                   |
| ---------------------------- | ------------------ | ---------------------------------------- |
| 1. Unit (query scoping)      | `src/unit/`        | `pnpm test:tenant-isolation:unit`        |
| 2. Integration (auth/authz)  | `src/integration/` | `pnpm test:tenant-isolation:integration` |
| 3. E2E (HTTP cross-tenant)   | `e2e/`             | `pnpm test:tenant-isolation:e2e`         |
| 4. Queue / event routing     | `src/queue/`       | `pnpm test:tenant-isolation:queue`       |
| 5. Search result trimming    | `src/search/`      | `pnpm test:tenant-isolation:search`      |
| 6. Cache namespace collision | `src/cache/`       | `pnpm test:tenant-isolation:cache`       |
| 7. Report export isolation   | `src/report/`      | `pnpm test:tenant-isolation:report`      |

The umbrella script that runs every category is:

```sh
pnpm test:tenant-isolation
```

It is invoked from the **CI tenant-isolation gate job** (see
`.github/workflows/ci.yml → tenant-isolation`).

## Test technique

- **Unit / Integration / Queue / Search / Cache / Report** use
  [Vitest](https://vitest.dev) + [fast-check](https://fast-check.dev). Every
  property runs against random tenant IDs so a bug that only affects, say,
  one tenant out of millions is more likely to surface.
- **E2E** uses [Playwright](https://playwright.dev/docs/api/class-apirequestcontext)
  in headless API-only mode: a small Fastify app is booted in-process via
  `e2e/global-setup.ts`, the real `@proctira/tenant` plugin is registered,
  and the suite drives HTTP requests through it. No browser, no Next.js,
  no external services needed — the gate stays fast (sub-second per spec)
  and deterministic.

## Reusing existing fixtures

The package depends on `@proctira/testing` so contributors can seed full
tenant fixtures (`createTenantFixture`, `createMultiTenantFixture`) when
adding deeper service-level tests. Helpers in `src/helpers/` (in-memory
RLS store, leak detector, shared arbitraries) are exported via the package
entry point so other suites can reuse them:

```ts
import {
  TenantScopedQueryLayer,
  assertNoForeignTenant,
  distinctTenantPairArb,
} from '@proctira/tenant-isolation-tests/helpers';
```

## Adding new isolation checks

1. Identify which category the new check belongs to.
2. Add the test under the matching `src/<category>/` (or `e2e/`) directory.
3. If the check exercises a real subsystem builder/helper, prefer importing
   that helper directly (see how `src/queue/event-routing.test.ts` uses the
   real `buildTenantTopic` / `buildTenantQueue` from `@proctira/events`).
4. Use the leak-detector helpers (`assertNoForeignTenant`,
   `assertNoForeignTenantInString`) so the failure message names the
   leaking tenant id.

## Failure semantics

A failing test in this suite means at least one of the following has
regressed:

- Tenant scoping in a query layer
- Auth/authz tenant binding
- HTTP-layer tenant resolution
- Tenant prefixing in queues/events
- Search index tenant filtering
- Cache key namespacing
- Report output isolation

Treat any failure as a release blocker. Investigate, fix, and only then
re-run the gate.
