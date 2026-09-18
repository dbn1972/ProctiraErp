# Evidence-first SIS/ERP gap-analysis method

## Objective

Determine enterprise readiness by tracing user and operator outcomes to executable evidence. Do not score package names, model counts, mock tests, comments, or aspirational documents as delivered capability.

## Required process

### 1. Establish inventory

Map applications, runtime composition, bounded contexts, schemas, API prefixes, active UI routes, mobile surfaces, integrations, jobs, shared infrastructure, CI/CD, observability, and runbooks.

### 2. Trace each capability vertically

For every module, inspect this chain:

`actor/use case → active UI/client → API contract → authz/scope → domain service/state machine → repository → production persistence/RLS → events/jobs/providers → audit/telemetry → tests → deployment/runbook`

A broken or placeholder link means the capability is partial even if the other layers exist.

### 3. Evaluate enterprise dimensions

- Functional lifecycle and exception handling
- Domain completeness and historical integrity
- Tenant isolation and fine-grained authorization
- Privacy, child-data and sensitive-record controls
- Data integrity, transactions, concurrency and reconciliation
- Integrations, event reliability and background jobs
- UI/mobile/offline/accessibility/localization
- Auditability and data governance
- Reliability, scalability, observability and supportability
- Testing, migration, release, backup and disaster recovery

### 4. Classify evidence, maturity, contradiction, and priority separately

Assign exactly one evidence status:

- **Implemented:** executable production path and appropriate verification exist.
- **Partial:** meaningful code exists, but a required lifecycle/layer/control is incomplete.
- **Absent:** the expected capability or required layer was not found after a documented search.
- **Unverified:** configuration/documentation/code may exist, but runtime or external evidence is unavailable.

Then record separate fields:

- **Contradiction:** `yes/no`; when yes, cite both sources and prefer runtime/code evidence.
- **Maturity:** `foundation`, `developed`, or `thin` when useful; this does not replace evidence status.
- **Priority:** `P0`, `P1`, `P2`, or `P3` for each actionable gap, not a combined module label.

### 5. Record every gap in a matrix

Use these columns:

| Field                     | Meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| Capability                | Specific workflow/control, not broad module name                 |
| Current evidence          | Concrete files, routes, models, tests, manifests, audited commit |
| Evidence status           | Exactly one of implemented/partial/absent/unverified             |
| Contradiction             | Yes/no plus conflicting evidence                                 |
| Maturity                  | Foundation/developed/thin where useful                           |
| Expected enterprise state | Observable target behavior/control                               |
| Gap                       | Missing or unsafe link                                           |
| Impact                    | Student/guardian/staff/finance/compliance/ops consequence        |
| Recommendation            | Smallest coherent remediation                                    |
| Dependencies              | Prerequisite domains/platform work                               |
| Priority                  | One of P0/P1/P2/P3 per gap                                       |
| Effort                    | S/M/L/XL, explicitly approximate                                 |
| Confidence                | High/medium/low based on evidence                                |

### 6. Prioritize by dependency and risk

- **P0:** tenant/auth/privacy/data-loss/deployment blockers; fix before production or further breadth.
- **P1:** core SIS lifecycle and financial/academic integrity; next release train.
- **P2:** enterprise depth, integration, operational maturity, and parity.
- **P3:** optimization and differentiated capability.

Sequence foundations before features:

1. Trusted auth/tenant/RBAC and durable persistence.
2. Audit/privacy/data governance and reliable jobs/events.
3. Core student/institution/academic workflow completion.
4. Finance/HR/operations integrity.
5. Portals, analytics, integrations, and optimization.

## Mandatory module questions

For each module answer:

1. Which actors can complete which end-to-end lifecycle today?
2. What is the authoritative data and how is history preserved?
3. Which invariants can fail under retries or concurrency?
4. How are tenant, area, institution, role, relationship, and field-level access enforced?
5. What side effects/jobs/integrations are real and durable?
6. Which active UI/mobile flows are live versus placeholders or duplicate shells?
7. Which tests use production adapters and include negative/tenant cases?
8. How is the module observed, operated, backed up, restored, reconciled, and rolled back?
9. What expected enterprise sub-capabilities are absent?
10. What is the smallest vertical slice that materially improves readiness?

## Output format

1. Executive verdict and confidence.
2. Architecture/runtime summary.
3. P0 blockers.
4. Module-wise findings table.
5. Cross-cutting control assessment.
6. Missing domain capabilities.
7. Dependency-aware 30/60/90-day and longer-term roadmap.
8. Verification limits and evidence index.

Never claim an audit is exhaustive unless every relevant repository area and external operating control was actually verified.
