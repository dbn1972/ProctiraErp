# Module map — API, database, screens, gaps

**Tip:** `0043e555` (`main`, 2026-09-25) — `chore(security): ignore every .env variant, not three of them (#385)`  
**Date (UTC):** 2026-09-25  
**Method:** static join of three inventories on this checkout. Not a live HTTP pass and not a SQL apply.

| Inventory | Source | Count |
| --------- | ------ | ----- |
| Backend route handlers | `packages/backend/*/src` Fastify `.get/.post/.put/.patch/.delete` (tests excluded) | 39 packages |
| SQL tables | `CREATE TABLE` in `db/sql/*.sql` | 225 tables |
| Staff / portal screens | `apps/web/src/app/**/page.tsx` | 204 pages |
| Screen → API prefixes | string literals `/…` and `/api/v1/…` under `apps/web/src` | 51 prefixes |

**What this pass did not do**

- No gateway process was listening (ports 3000 / 4000 / 8080 closed). No endpoint was called over HTTP.
- `node_modules` is not installed on this cloud VM, so package unit tests were **not executed**. “Test files” below means files on disk (`*.test.ts` / `*.spec.ts`), not a green run.
- Route counts are a lower bound. Builders that assemble the path outside the call, and gateway-only plugins (`insights-ui`, `platform-admin-ui`, `workflow-ui`), are not in the backend package counts.
- Almost every mounted domain still has an in-memory fallback when `DATABASE_URL` is unset. A screen that renders in dev does not prove a Postgres row.

Mount source of truth: `apps/api-gateway/src/mount-matrix.ts` and `docs/audits/GATEWAY_MOUNT_MATRIX.md`.

---

## How to read a row

| Word | Meaning |
| ---- | ------- |
| **LINKED** | Mounted prefix, package routes, SQL (or an explicit document store), and at least one screen or `apps/web` client that calls that prefix. |
| **PARTIAL** | Two of the three exist, or the third is only a stub / in-memory / parked package with a leftover caller. |
| **GAP** | A product surface is missing: API with no screen, screen calling an unmounted API, or durable data with no UI. |

---

## Mounted modules

| Module | Prefix(es) | Handlers | Test files | SQL | Screens (pages) | Disposition |
| ------ | ---------- | -------: | ---------: | --- | --- | ----------- |
| student | `/students`, `/enrollments` | 31 | 23 | `035` students 360 + Prisma | `/students` 9 | **LINKED** |
| institution | `/institutions`, `/academic-periods`, `/grades`, `/classes`, `/subjects`, `/infrastructure` | 44 | 24 | `027`, `029`, `030` | `/institutions` 15, `/academic-periods` 3 | **LINKED** |
| staff | `/staff` | 45 | 20 | `043`, `013`, `018` | `/staff` 12 | **LINKED** |
| attendance | `/attendance` | 18 | 9 | `042` | `/attendance` 3 | **LINKED** |
| examination | `/examinations` | 35 | 18 | `036` | `/examinations` 8 | **LINKED** |
| assessment | `/assessments`, `/grading-schemes`, `/assessment-items`, `/outcomes`, `/results`, `/report-cards` | 21 | 13 | `024` report cards | `/assessments` 7 | **LINKED** |
| timetable | `/timetable` | 35 | 7 | `003`, `041` | no `/timetable` staff page folder; client `lib/api/timetable.ts` (23 refs) | **PARTIAL** — API+SQL+client, staff route folder missing |
| gradebook | `/gradebook` | 33 | 9 | `003`, `004`, `032` | client `lib/api/gradebook.ts`; no `/gradebook` page folder | **PARTIAL** — same shape as timetable |
| curriculum | `/curriculum` | 8 | 3 | `033` | client only (`lib/api/curriculum.ts`, 9 refs); no `/curriculum` pages | **PARTIAL** |
| lms | `/lms` | 48 | 6 | `026`, `038` | `/lms` 10 | **LINKED** |
| scholarship | `/scholarships` | 17 | 7 | `016`, `060`, `079` | `/scholarships` 7 | **LINKED** |
| health | `/health` | 42 | 19 | `012`, `017`, `046`, `049` | `/health` 13 | **LINKED** (creates are stronger than updates; see residuals) |
| notification | `/notifications` | 19 | 11 | mixed PG deliveries | `/notifications` 2 | **LINKED** — thin UI vs 19 handlers |
| transport | `/transport` | 38 | 8 | `006`, `045` | `/transport` 10 | **LINKED** |
| communication | `/communication` | 16 | 10 | `007`, `044` | `/communication` 8 | **LINKED** — live Twilio/SES/WhatsApp still sandbox |
| hostel | `/hostel` | 31 | 6 | `008`, `040` | `/hostel` 9 | **LINKED** |
| library | `/library` | 23 | 6 | `009`, `039` | `/library` 7 | **LINKED** |
| parent-portal | `/parent-portal`, `/student-portal` | 25 | 5 | `010` | `/parent` 16, `/student` 9 via `lib/api/parent-portal.ts` (`/student-portal/me/*`) | **LINKED** |
| fees | `/fees` | 36 | 13 | `011`, `023`, `031`, `048`, `057`–`061` | `/fees` 9 | **LINKED** — PSP is sandbox |
| registration | `/registrations`, `/admissions` | 29 | 11 | `014`, `034`, `097` | `/admissions` 5; registrations client only | **PARTIAL** — admissions UI, registration pipeline UI thin |
| developer-portal | `/developer` | 34 | 8 | `055`, `089`, `093`, `094` | no `/developer` pages in `apps/web` | **GAP** — API+SQL, no staff/developer screen in this app |
| auth | `/auth` | 25 | 25 | `066` session tables; PG identity when `DATABASE_URL` set, else memory | `/login`, `/signup`, `/mfa`, `/forgot-password`, `/reset-password` | **LINKED** with memory fallback |
| audit | `/audit-logs` | 8 | 6 | `022`, `028` | `/audit-logs` 2 | **LINKED** |
| billing | `/billing` | 17 | 6 | PG via `PgBillingRepository` when `DATABASE_URL` set | `/billing` 1 | **PARTIAL** — one screen for 17 handlers; matrix text still says “in-memory” and is stale vs `create-billing-repository.ts` |
| providers | `/providers` | 0 in package (facade only) | 2 | none | no `/providers` pages | **GAP** — discovery API is gateway-owned; SMS/email/push/PSP adapters are not live |
| tenant | `/tenant-lifecycle`, `/tenant`, `/scim` | 32 | 12 | `022` control plane | `/tenant-lifecycle` 1, `/admin` 6 | **PARTIAL** — SCIM and lifecycle have little UI |
| report | `/reports` | 25 | 7 | `037` | `/reports` 6 | **LINKED** |
| insights-ui | `/data-warehouse` (+ board summary) | gateway plugin | — | `020` | `/data-warehouse` 4 | **PARTIAL** — UI is the insights plugin, not `backend/data-warehouse` |
| etl | `/pipelines` | 6 | 12 | `046` | `/pipelines` 1; clients also say `/etl` | **PARTIAL** — two prefixes in the UI (`/pipelines` mounted, `/etl` not a registrar) |
| workflow-ui | `/workflows` | gateway plugin | — | `025` via engine | `/workflows` 5 | **LINKED** to engine-backed UI store |
| workflow engine | `/workflow-engine` | 14 | 12 | `025` | no page calls `/workflow-engine` directly | **PARTIAL** — UI uses `/workflows`; engine prefix is headless |
| privacy | `/privacy` | 8 | 4 | `067`, `078`, `090` | none (`/legal/privacy` is a policy page, not this API) | **GAP** — legal hold / erasure / offboard have SQL+API and no operator screen |
| platform-admin-ui | `/tenants`, `/plans`, `/plugins`, `/themes`, `/break-glass`, `/audit`, `/platform` | gateway UI plugin | — | seed / stubs | mixed into `/admin` | **PARTIAL** — several prefixes are UI stubs, not the domain package |

---

## Unmounted packages (API exists, gateway does not serve it)

These packages still contain route handlers. `mount-matrix.ts` keeps them parked. A screen or client that calls the prefix will not hit this package.

| Package | Handlers | Test files | Why it is parked | Screen caller? | Gap |
| ------- | -------: | ---------: | ---------------- | -------------- | --- |
| custom-field | 8 | 4 | No durable PG adapter; boot refused | 1 ref (`lib/api/students.ts`) | **GAP** — caller vs unmounted API |
| dashboards | 3 | 2 | No durable aggregate adapter | ~10 refs under `lib/api/dashboards.ts` and dashboard pages | **GAP** — UI still names `/dashboards` while the package is parked; role dashboards are supposed to live on `backend/report` |
| data-warehouse | 15 | 3 | Superseded by insights `/data-warehouse` | screens call insights prefix, not `/warehouses` | **GAP** — package routes are dead; do not treat package tests as the live DW API |
| survey | 8 | 3 | No product surface | none | **GAP** — API only |
| theme | 7 | 3 | `/themes` owned by platform-admin stub | none on this package | **PARTIAL** |
| policy | 9 | 3 | Superseded by audit retention scheduler | none | **GAP** — API only |
| plugin | 7 | 5 | `/plugins` owned by platform-admin UI | none on this package | **PARTIAL** |
| install | 3 | 2 | Must not be on a live tenant gateway | none | **GAP** (intentional) |
| admin-dashboard | 4 | 0 | Superseded by platform-admin + insights | none | **GAP** — routes and **zero** tests |

---

## Cross-module gaps (the list)

These are the breaks a file-by-file reading misses, because each side looks finished alone.

1. **Privacy lifecycle has no screen.** `POST/GET` under `/privacy` and tables in `067` / `078` / `090` (legal hold, erasure, consent versions) have no operator page. `/legal/privacy` does not call them.
2. **Developer portal has no web screen.** 34 handlers and SQL `055` / `089` are mounted at `/developer`. `apps/web` has no `/developer` pages.
3. **`/dashboards` clients point at a parked package.** `lib/api/dashboards.ts` and board dashboard pages still request `/dashboards`. The gateway does not mount `backend/dashboards`.
4. **`/custom-fields` is in the RBAC map and in one student client, and the package is parked.** `PATH_RESOURCE_MAP` lists `custom-fields`, and `lib/api/students.ts` mentions it. `custom-field` is unmounted.
5. **ETL prefix split.** Mounted API is `/pipelines` (SQL `046`). Web also calls `/etl` (`features/etl/pages/PipelineBuilder.tsx`). Those are not the same registrar.
6. **Curriculum, gradebook, and timetable have APIs, SQL, and TypeScript clients, but no matching `app/` route folder.** Staff cannot open `/curriculum`, `/gradebook`, or `/timetable` as a page. The clients are only useful if some other page imports them.
7. **Workflow engine is headless.** Screens talk to `/workflows` (UI plugin). `/workflow-engine` (14 handlers, SQL `025`) has no direct page.
8. **Billing UI is one page for 17 handlers.** Postgres repository exists (`createBillingRepository`), so the older “billing is only in-memory” matrix sentence is stale. The screen coverage is still thin.
9. **Notification UI is two pages for 19 handlers.** Preferences/inbox exist; devices, rules, and provider delivery are mostly API.
10. **Registration vs admissions.** `/admissions` has 5 pages. `/registrations` is mostly the client library, not its own screen set.
11. **Providers are not a product module yet.** The package exports a sandbox facade and no HTTP routes. Live SMS, email, push, and PSP adapters are intentionally not implemented. No screen.
12. **SCIM and tenant lifecycle are API-heavy.** 32 tenant handlers versus one `/tenant-lifecycle` page and the `/admin` console.
13. **Survey, policy, and admin-dashboard are unreachable product APIs.** They are not mounted and have no screens. `admin-dashboard` has no tests.
14. **In-memory fallback is still the dev path.** Mounted domains render without Postgres. That is not a per-module bug, and it is why a screenshot cannot prove the SQL column is the one the screen saved.
15. **Health writes are uneven.** PHI and several clinical creates share a transaction with audit. Updates and deletes on those stores do not. That is an API-to-database integrity gap, not a missing page (`/health` has 13 screens).

---

## Screen folders with no module of the same name

| Screen folder | Pages | Where the API actually is |
| ------------- | ----: | ------------------------- |
| `/parent`, `/student` | 16 + 9 | `/parent-portal`, `/student-portal` |
| `/admin` | 6 | `/tenant` plus platform-admin UI stubs |
| `/login`, `/signup`, `/mfa`, `/auth` | auth chrome | `/auth` |
| `/legal` | 2 | static policy copy, not `/privacy` |
| `/help`, `/track` | 1 each | no domain package |

---

## What to do with this file

Do not treat this document as a close-out of any Wave-1 finding. It is a map. The next useful pass is live: boot Postgres, apply `db/sql`, start the gateway, and call one read and one write per **GAP** and **PARTIAL** row above. Until that run exists, these rows stay source-level gaps.
