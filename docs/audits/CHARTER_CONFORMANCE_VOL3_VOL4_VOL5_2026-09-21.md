# Charter conformance — Volumes 3, 4 and 5

**Audited tip:** `main` = `12705129`
**Specifications:**

- `docs/multitenant/volume_03_system_design_specification.md` (System Design)
- `docs/multitenant/volume_04_api_and_developer_platform_specification.md` (API and Developer Platform)
- `docs/multitenant/volume_05_security_and_compliance_control_matrix.md` (Security and Compliance Control Matrix)

Companion to `CHARTER_CONFORMANCE_VOL1_VOL2_2026-09-21.md`. Volume 3 §7 restates
Volume 1 §19, so findings V1, V2 and V4 in that report apply here unchanged and are
not repeated.

---

## V7 — None of the 22 named tables exist

**Violates:** Volume 3 §7 and Table 2; Volume 2 Table 7; Volume 1 §19.2
**Status:** `absent` · **Severity: high**

Volume 3 Table 2 does not merely require a naming convention — it names the tables
each service owns. Resolved individually against the live catalogue with
`to_regclass`:

| Service  | Named in Volume 3 Table 2                                          | Exists |
| -------- | ------------------------------------------------------------------ | ------ |
| identity | `identity_users`, `identity_sessions`, `identity_service_accounts` | 0 of 3 |
| tenant   | `tenant_tenants`, `tenant_org_units`, `tenant_settings`            | 0 of 3 |
| billing  | `billing_subscriptions`, `billing_entitlements`                    | 0 of 2 |
| audit    | `audit_events`, `audit_exports`                                    | 0 of 2 |
| policy   | `policy_policies`, `policy_bindings`                               | 0 of 2 |
| plugin   | `plugin_plugins`, `plugin_installs`, `plugin_permissions`          | 0 of 3 |
| theme    | `theme_themes`, `theme_revisions`                                  | 0 of 2 |
| queue    | `queue_messages`, `queue_consumers`, `queue_dead_letters`          | 0 of 3 |
| install  | `install_bootstrap_runs`, `install_adapter_configs`                | 0 of 2 |

**Total: 0 of 22.**

This is a sharper statement of V1. Several of these capabilities do exist — audit,
themes, plugins, billing all have working implementations — but none is persisted
under the specified ownership model. The identity and billing cases are the most
consequential: their records are documents inside the shared
`control_plane_documents` table rather than service-owned tables, which is the same
defect as V2 and the open P0.

Note `queue_*` and `install_*`: Volume 3 expects messaging delivery control and
bootstrap state to be persisted and therefore inspectable. Neither has a table, so
queue delivery state and install adapter configuration are not durable product
state in the way the specification assumes.

---

## V8 — No first-party SDK

**Violates:** Volume 4 §9; Volume 1 §22.2 ("SDK docs")
**Status:** `absent` · **Severity: medium**

Volume 4 §9 requires first-party SDKs providing auth helpers, pagination helpers,
retry guidance, error parsing and webhook verification utilities.

No SDK package exists. `tools/install-cli` is the only CLI-shaped artefact, and it
addresses installation rather than the API surface. Volume 4 §9's CLI requirements —
credential management, health checks, debugging paths — are not met by it.

Consequence for Volume 4 §2: "time-to-first-success" cannot be measured because
there is no supported client path to succeed with.

---

## V9 — Error envelope standard is not applied consistently

**Violates:** Volume 4 §6
**Status:** `partial` · **Severity: medium**

Volume 4 §6 specifies a single error envelope: `code`, `message`, `detail`,
`correlationId`, `retryable`, `fieldErrors[]`.

Field presence across `apps/api-gateway/src` and `packages/shared`:

| Field           | Files |
| --------------- | ----- |
| `correlationId` | 16    |
| `fieldErrors`   | 3     |
| `retryable`     | **1** |

`correlationId` is reasonably established. `retryable` appearing in a single file
means the retryability hint is effectively absent from the API contract, so clients
cannot distinguish a transient failure from a permanent one — which Volume 4 §7 and
§9 both assume they can.

Not verified: whether the envelope is centrally enforced or reimplemented per
route. That distinction matters for remediation and was not established.

---

## V10 — Endpoint domains missing from the governed API surface

**Violates:** Volume 4 §5 and Table 2
**Status:** `partial` · **Severity: medium**

Method note: an initial grep for literal `/api/v1/<domain>` understated the surface,
because domain plugins register a prefix and declare relative paths. The finding
below uses the actual registered prefix list instead. This correction is recorded
because the first result would have overstated the gap.

Registered and matching Table 2: `auth`, `tenants`, `themes`, `plugins`, `audit`,
`health`, plus `billing`, `plans`, `platform`, `scim`, `developer`, `break-glass`.

**Absent as governed domains:**

| Table 2 domain               | Evidence                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| `/api/v1/service-accounts/*` | no prefix; **0** gateway files mention it                         |
| `/api/v1/org-units/*`        | no prefix; **0** gateway files mention it                         |
| `/api/v1/compliance/*`       | no prefix registered                                              |
| `/api/v1/events/*`           | no prefix registered                                              |
| `/api/v1/queue/*`            | no prefix; 5 files mention queue, none expose an operator surface |
| `/api/v1/settings/*`         | no prefix registered                                              |

**Present but not as their own domain:** `roles` (34 files, no prefix),
`entitlements` (5 files), `webhooks` (1 file), `subscriptions` (served under
`billing`). Capability exists; the governed resource domain does not.

`service-accounts` is the most significant. Volume 4 §4 requires service account and
plugin identities with explicit scopes, and Volume 5 §3 requires service account
scopes be "supported and governed". Without the domain there is no surface to create
or scope a machine identity, which also undercuts Volume 4 §11's sandbox and
non-production credential requirement.

`/api/v1/queue/*` matters for Volume 5 §6, which requires queue replay and redrive
to be audited, and Volume 3 §12, which requires queue backlog observability.

---

## V11 — Security control matrix: largely unverified, with two confirmed gaps

**Volume 5 status:** mostly `unverified` · two confirmed items below

Volume 5 is a control matrix whose satisfaction depends on operational evidence —
Table 1 requires named owners and evidence artefacts per control family. This pass
examined code, not evidence artefacts, so most of Volume 5 cannot be graded here.
Recording it as `unverified` rather than compliant.

**Confirmed gaps:**

_§6 audit coverage._ Volume 5 §6 requires audit records for install/bootstrap
actions and for queue replays or redrive. Neither has persistence (V7:
`install_*` and `queue_*` tables absent) nor an API surface (V10:
`/api/v1/queue/*` absent), so these two audit classes cannot currently be recorded.
The hash-chained audit trail itself is real and was proved tamper-evident live
(#331), so this is a coverage gap rather than an absent capability.

_§4 tenant boundary breadth._ Volume 5 §4 requires tenant boundaries preserved "in
storage, cache, search, queues, analytics, backups, and exports". Storage isolation
is proved live. The other six layers were not tested and Volume 1 §39.2 requires
each of them independently. Unverified, and it is a large surface.

**Cannot be assessed at all:** §7 operational resilience — backups, restore tests,
DR drills, SLOs — because no environment is deployed and `db/sql` cannot migrate an
empty database (T1 and T11). Volume 5 §7 also requires published upgrade, rollback
and compatibility boundaries for self-hosted editions, which depends on the same
blockers.

**Break-glass:** a `break-glass` prefix is registered, so the capability exists.
Whether it satisfies §3's approval, time-boxing and post-use review requirements was
not examined.

---

## Where the implementation is ahead of the specification

Stated to keep the report calibrated.

Volume 3 §8 requires adapters behind stable internal contracts with schema, health
check, retry policy and contract tests. The queue abstraction meets the structural
part of this well: three real adapters behind
`packages/shared/queue-abstraction/src/factory.ts`, selected by `QUEUE_BACKEND`,
with domain services publishing through the abstraction rather than binding to a
provider. Volume 3 §9's requirement that "queue adapter selection must not change
core service business semantics" is satisfied by that design.

Adapters also exist for object storage, search, SCIM, SAML, KMS/Vault and
OpenTelemetry. Presence is not conformance — none was tested against §8's contract
test and failure-behaviour requirements.

---

## Consolidated priority across all five volumes

1. **V2 / V7** — service table ownership. One piece of work closes the shared-table
   violation, the naming violation, the 22 missing tables, and the open P0, because
   they are all consequences of the same design.
2. **V4** — the cross-service FK contradiction. Needs the charter owner. Blocks
   knowing whether V7's remediation direction is correct.
3. **V3** — remove the MySQL option or implement it.
4. **V10** — `service-accounts` first; it gates machine identity, scoping and the
   sandbox path.
5. **V8**, **V9** — SDK and error envelope.
6. **V11** — requires T1 and T11 resolved before most of it can even be measured.

## Honest limits of this report

Grading covers what is inspectable in code and in a live database. It does not cover
performance and availability NFRs, SLO and runbook coverage, the threat model and
abuse case catalog, compliance evidence artefacts, WCAG conformance, public legal
pages, or isolation in the cache, search, queue, analytics, backup and export layers.

Those are `unverified`. Several are large enough that they could change the overall
picture materially, and none should be read as compliant.
