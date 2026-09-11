# Gap register — production-ready master audit (2026-09-10)

**Tip:** `38b3f2a` · Prefer fixing Sev S0→S1 before polishing S3.  
IDs `PRD-*` are new planning IDs from this scorecard. `G-*` reuse the enterprise gap register / waivers.

| Gap ID  | Module         | Page / surface               | Sev | Pillar   | What’s wrong                                               | Evidence                            | Fix                                                                                                           | Acceptance                                               | Depends       | Size | Batch |
| ------- | -------------- | ---------------------------- | --- | -------- | ---------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------- | ---- | ----- |
| PRD-001 | Release        | Tip CI / PR #48              | S0  | Release  | **CLOSED** — tip CI SUCCESS on `38b3f2a`                   | `gh pr checks 48` all SUCCESS       | —                                                                                                             | All required checks green on tip SHA                     | —             | M    | 1     |
| PRD-002 | DW / Insights  | `/data-warehouse*`, overview | S1  | Build/UX | Scaffold banners + field-mapping demo; DW package PARKED   | Mount matrix; ScaffoldModeBanner    | Either de-scaffold live connectors **or** release-note + UI “demo” classification; keep package PARKED honest | No false “live warehouse” claim; banner accurate         | —             | L    | 2     |
| PRD-003 | Platform admin | `/admin/*`                   | S1  | Build    | Stub/scaffold admin APIs                                   | Mount matrix; admin smokes          | Prefer-live control-plane or mark console “ops stub” in IA                                                    | Admin pages never imply live billing/plugins without API | —             | L    | 2     |
| PRD-004 | Health         | `/health/special-needs`      | S1  | Data     | Special-needs still in-memory while PHI elsewhere is PG    | Module maturity; health hybrid repo | PgSpecialNeedsStore (or fold into PHI store) + migration                                                      | Restart-safe special-needs with DATABASE_URL             | Health Wave10 | M    | 2     |
| G-107   | Auth           | Login / MFA                  | S1  | Security | Live IdP not proven                                        | Gap register WAIVED                 | Staging Keycloak realm + e2e login                                                                            | Login via live IdP green in CI or keep waiver signed     | Secrets       | L    | 4     |
| G-202   | Fees           | Pay / receipts               | S1  | Build    | Live PSP waived                                            | Gap register                        | Sandbox PSP keys + receipt proof                                                                              | Paid invoice → receipt against sandbox                   | Secrets       | L    | 4     |
| G-709   | Comms / Notify | Campaigns / push             | S1  | Build    | Live email/SMS/push waived                                 | Gap register                        | Provider sandbox adapters + delivery log                                                                      | One live sandbox send per channel                        | Secrets       | L    | 4     |
| G-506   | Ops            | Status / pager               | S2  | Release  | Incident comms waived                                      | Gap register                        | Statuspage/pager wiring or keep waiver                                                                        | Runbook + waiver                                         | Vendor        | M    | 5     |
| PRD-005 | Multi          | Health/Fees/Students writes  | S2  | Security | Fine-grained rbacPlugin absent on many domains             | Mount matrix “RBAC wired? No”       | Add deny proofs for sensitive mutations                                                                       | Cross-role 403 tests                                     | —             | M    | 3     |
| PRD-006 | Test           | Program e2e                  | S2  | Test     | Write smokes often need E2E_BACKEND_READY; ungated = shell | e2e headers                         | Expand always-on validation; document gate matrix                                                             | CI job matrix shows which specs need backend             | PRD-001       | M    | 3     |
| PRD-007 | Mobile         | Flutter / farm               | S2  | Mobile   | Device-farm / native parity not tip-proven                 | G-407 waiver history                | Farm run or signed waiver for release                                                                         | Goldens + 1 farm lane or waiver                          | Vendor        | L    | 5     |
| PRD-008 | Assessments    | Report cards                 | S2  | Data     | Assessment report-cards path still memory                  | Maturity table                      | Persist via gradebook HTML path only / migrate                                                                | No silent loss on restart                                | Gradebook     | M    | 3     |
| PRD-009 | ETL            | `/pipelines`                 | S2  | Test/UX  | Thin UI; no dedicated write smoke                          | Matrix only                         | Add `5x-pipelines-write-smoke` + nav discoverability                                                          | Create pipeline → list survives restart w/ DB            | ETL mount     | S    | 2     |
| PRD-010 | Transport      | Live map                     | S3  | UX       | SVG+OSM not MapLibre (accepted non-goal historically)      | PRODUCT transport                   | Keep non-goal **or** MapLibre epic                                                                            | Documented in release notes                              | —             | L    | 5     |
| PRD-013 | Timetable      | iCal / federation            | S3  | Build    | No live iCal feed / federation                             | Product lock                        | Non-goal                                                                                                      | Waiver                                                   | Scheduling    | L    | —     |
| PRD-011 | Gradebook      | Transcripts                  | S3  | Build    | HMAC stub ≠ CA-sealed PDF                                  | SEC notes                           | Epic or non-goal                                                                                              | Waiver or sealed PDF                                     | Compliance    | L    | 5     |
| PRD-012 | LMS            | LTI/SCORM                    | S3  | Build    | Explicitly waived                                          | LMS audit                           | Keep waiver                                                                                                   | Waiver row current                                       | —             | —    | 5     |
| B3-\*   | UX             | Batch-3 leftovers            | S3  | UX       | B3-006…011 fixed; B3-012 waived                            | WAVE9_BATCH3_UX_REVIEW              | None                                                                                                          | Closed on this tip                                       | —             | —    | done  |

### Already closed on this tip (do not re-open)

| ID                     | Note                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| Wave10 Health Option B | Allergies, vaccinations, PHI viewer, nurse incidents (+ PG 046 incidents) |
| Wave10 Option C        | ETL mount `/pipelines`, G-809 board 403                                   |
| B3-006…B3-011          | Fixed; B3-012 waived 2026-09-10                                           |
| G-1001…G-1004          | Done on PR #41                                                            |

### Waiver board (accept or fund)

| Waiver                      | Blocks score ceiling   |
| --------------------------- | ---------------------- |
| Live IdP (G-107)            | Auth ≤ ~7.5 without it |
| Live PSP (G-202)            | Fees pay ≤ ~7.8        |
| Live Twilio/SES/FCM (G-709) | Comms/notify ceiling   |
| Device farm (PRD-007)       | Mobile ceiling         |
| LTI/SCORM (PRD-012)         | LMS peer parity        |
| MapLibre (PRD-010)          | Transport map parity   |
| Statuspage (G-506)          | Ops ceiling            |

### Closed this pass (2026-09-10 headless gap closure → ~8.5 target)

| Gap ID                                        | Resolution                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRD-004                                       | **CLOSED** — `PgSpecialNeedsStore` already hybrid-wired when `DATABASE_URL`; mount matrix + scorecard corrected.                                                |
| PRD-002                                       | **CLOSED (honesty)** — DW banner forces demo/PARKED classification; package stays PARKED.                                                                       |
| PRD-003                                       | **CLOSED (honesty)** — Admin banner labeled ops stub (not live billing/plugins).                                                                                |
| PRD-009                                       | **CLOSED** — `apps/web/e2e/5x-pipelines-write-smoke.spec.ts` ungated shell + gated create.                                                                      |
| PRD-005                                       | **CLOSED (proofs)** — Health PHI deny → 403 `ForbiddenError`; fees `assertFeesAccess` on pay; student `assertStudentWriteAccess` on create/update + unit tests. |
| PRD-006                                       | **CLOSED** — `docs/testing/E2E_GATE_MATRIX.md` published.                                                                                                       |
| PRD-008                                       | **CLOSED** — Report-cards already use `createReportCard*Repository()` (PG/`024` when DB); mount matrix corrected.                                               |
| G-107 / G-202 / G-709                         | **WAIVER REFRESHED** — secrets not available on this headless run; remain release-board WAIVED (dated 2026-09-10).                                              |
| PRD-007 / PRD-010 / PRD-011 / PRD-012 / G-506 | **NON-GOAL / WAIVED** — device-farm, MapLibre, sealed PDF, LTI/SCORM, statuspage — not funded this pass.                                                        |
| PRD-001                                       | **CLOSED** — tip CI SUCCESS on `38b3f2a` (CI + E2E Backend Ready + DoD/PR Check/Supply Chain).                                                                  |

| Exams + Timetable 9.0 uplift | **CLOSED** — domain RBAC, period Select, clash 409 e2e, PRD-011/013 NON-GOAL; MODULE scores → 9.1 / 9.0 PROD_WAIVED. |

| Overnight PARTIAL→PROD_WAIVED sync | **CLOSED** — Staff domain RBAC (`staff-access`); Health/ETL/Admissions/Auth/Notify/Workflows/Reports/DW/Admin rescored PROD_WAIVED with G-107/G-709/OCR/demo honesty. PRD-001 tip CI CLOSED on `38b3f2a`. |
