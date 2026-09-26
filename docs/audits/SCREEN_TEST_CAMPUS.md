# Screen test — Campus services (Hostel, Transport, Library)

**Date (UTC):** 2026-09-26  
**Tenant:** Sunrise Public School `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` after Prisma migrate and `APPLY_STRICT_FKS=1` domain SQL. Hostel, transport fleet, and library holdings are **not** seeded for this tenant.  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`. No password login exists on this seed.  
**Stack:** Postgres 16, Redis 7, api-gateway `:3000`, Next.js dev `:3001`. Walked in headless Chromium.

This is a route walk of the staff **hostel**, **transport**, and **library** trees plus parent/student library surfaces. It is not a production-ready or 10/10 claim. **Attendance** routes under hostel and transport were not opened. Communication, fees, and other campus modules are out of scope.

Destructive checks: transport **Remove stop** opened `ConfirmActionDialog` and was **cancelled** (no stop deleted). No irreversible hostel or transport deletes were submitted.

## Aggregate

| Module    | Routes walked | PASS | FAIL | BLOCKED |
| --------- | -------------: | ---: | ---: | ------: |
| Hostel    |              8 |    8 |    0 |       0 |
| Transport |              9 |    9 |    0 |       0 |
| Library   |              9 |    9 |    0 |       0 |

No code changes were required in the three route trees on this walk.

## Hostel route table

| Route | Primary action | Result | What the screen showed |
| --- | --- | --- | --- |
| `/hostel` | Read overview | **PASS** | Hub, empty hostel list (“No hostels yet”), create-hostel form. Submit empty → “Name and code are required.” No UUID in primary copy. |
| `/hostel/structure` | Read blocks/rooms | **PASS** | Empty structure honest state; no holdings to label. |
| `/hostel/assignments` | Open assignment form | **PASS** | No beds yet; student search uses Sunrise names (`SPS-NID-001 · Aarav Mehta`, etc.), not UUIDs. |
| `/hostel/leaves` | Open new leave | **PASS** | Empty leave list; student `<select>` options are national-id · name labels. |
| `/hostel/visitors` | Read visitor log | **PASS** | Empty visitor list. |
| `/hostel/gate-passes` | Read gate passes | **PASS** | Empty gate-pass list. |
| `/hostel/mess` | Read mess plans | **PASS** | Empty mess plans. |
| `/hostel/fees` | Read fee structures | **PASS** | Empty hostel fee structures. |

Skipped by instruction: `/hostel/attendance`.

## Transport route table

| Route | Primary action | Result | What the screen showed |
| --- | --- | --- | --- |
| `/transport` | Read hub | **PASS** | Cards to routes, vehicles, assignments, live map, fees; attendance link not followed. |
| `/transport/routes` | Read route list | **PASS** | After creating **Sunrise screen route** (Campus gate → City depot), list shows route **name**, not id. |
| `/transport/routes/new` | Validate create | **PASS** | Submit name-only → “Name is required.” Full create adds one active route for stops walk. |
| `/transport/routes/[id]/stops` | Manage stops | **PASS** | Heading `Stops — Sunrise screen route`. Added stop **Stop A**; **Remove stop** opened confirm; **Cancel** closed dialog (stop retained). No UUID primary labels. |
| `/transport/vehicles` | Read fleet | **PASS** | Empty vehicles honest state. |
| `/transport/assignments` | Open student assign | **PASS** | Student picker uses Sunrise name labels; routes/stops empty until fleet exists. |
| `/transport/alerts` | Read alerts | **PASS** | Empty alerts feed. |
| `/transport/live` | Read live map | **PASS** | Empty map shell; no raw device UUIDs in chrome. |
| `/transport/fees` | Read transport fees | **PASS** | Empty fee structures (distinct from main Fees module). |

Skipped by instruction: `/transport/attendance`.

## Library route table

| Route | Primary action | Result | What the screen showed |
| --- | --- | --- | --- |
| `/library` | Read catalog | **PASS** | Empty holdings → “No holdings yet”; add-item and ISBN import forms present. |
| `/library/circulation` | Read desk | **PASS** | Empty loans/returns honest state; student labels use names when picker populated. |
| `/library/overdues` | Read overdues | **PASS** | Empty overdues list. |
| `/library/opac` | Search OPAC | **PASS** | Search form; empty results honest. |
| `/library/holds` | Read holds queue | **PASS** | Empty holds. |
| `/library/fines` | Read fines | **PASS** | Empty fines. |
| `/library/[id]` | Open title detail | **PASS** | Created **Screen test volume**; detail heading is title; accession `LIB-2424F7C3-001` (not a raw UUID primary label). |
| `/parent/library` | Parent portal view | **PASS** | Staff session: “No linked children yet” / link-child empty state (honest). |
| `/student/library` | Student portal view | **PASS** | OPAC-style empty state for student shell. |

## Rows this walk added (local DB only)

These writes support dynamic routes and are not part of `006_sunrise_public_school_demo.sql`:

- Transport route **Sunrise screen route** (`b3d757e1-9577-4323-91f0-3cdf16e36045`).
- Transport stop **Stop A** on that route (remove confirm cancelled).
- Library holding **Screen test volume** (`2424f7c3-6d19-4afe-af96-c50bb37b094c`).

## Fixes from the walk

None — no FAIL findings in the three route trees on tip `df560717`.
