# Enterprise product / IA checklist

**Module / slice:** Cross-board student transfer approval + grade equivalency  
**Branch / tip:** `cursor/cross-board-transfer-workflow-4147`  
**Date (UTC):** 2026-09-28  
**Owner / agent:** transfer workflow implementation

---

## 1. Capability statement

A requesting-school registrar or principal can draft and submit a student move to another school in the same tenant, including a school on a different board (CBSE, ICSE, or a state board). The receiving principal reviews the request, sees the grade and subject equivalency for that board pair, and approves or rejects it with a comment. Completion, in one database transaction, marks the source enrollment `TRANSFERRED`, opens an `ENROLLED` enrollment at the destination institution (so the student's school and board follow that institution), and publishes a `student.transfer.completed` outbox event. Tenant administrators maintain the equivalency rules. Parents do not operate this queue.

## 2. Personas & jobs

| Persona | Job-to-be-done | Success looks like |
| ------- | -------------- | ------------------ |
| Requesting registrar / principal | Start a transfer and cancel it before it is finished | Draft is saved, submitted, and visible to the receiving school |
| Receiving principal | Decide whether to accept the student | Approve or reject with a comment; completion places the student |
| Board / tenant admin | Keep CBSE↔ICSE↔state equivalency current and unblock any school | Rules save; admin can act on any school in the tenant |
| Teacher / parent | Must not approve or edit rules | Gateway 403 on writes; parent read of the queue is denied in the service |

## 3. Scope

| In scope | Non-goals |
| -------- | --------- |
| States `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED`, then `COMPLETED` or `CANCELLED` | Transfer certificate PDF generation (existing TC/lifecycle certificate module is unchanged) |
| Approval history (actor, decision, comment, timestamps) | Multi-tenant transfers (one `tenant_id`; another tenant's id is 404) |
| Grade equivalency: source board + grade + subject → target board + grade + subject, marks scale and credit factor | Automatic transcript recalculation or board export file changes |
| Completion moves enrollment; board is the destination institution's board | Parent-shell transfer request |
| Confirm dialog before reject and cancel | Rewriting the immediate `POST /enrollments/transfer` path |

## 4. Peer parity

| Peer capability | Our target this slice |
| --------------- | --------------------- |
| PowerSchool transfer workflow with school approval | Named states, role checks, comment on reject |
| Infinite Campus course/grade equivalency on cross-district entry | Tenant-scoped board pair rules and a lookup used at approval |
| Ellucian-style enrollment status history | Source enrollment `TRANSFERRED`, destination `ENROLLED`, history via the existing enrollment trigger, outbox event |

## 5. Surface map

| Nav label | Route | API | Tables / events | Shell |
| --------- | ----- | --- | --------------- | ----- |
| Transfers | `/transfers` | `GET /api/v1/transfers/pending`, equivalency CRUD | `transfer_records`, `grade_equivalency_rules` | Staff |
| Transfer detail | `/transfers/[id]` and dashboard `/app/dashboard/cross-board-transfer/:transferId` | `GET/POST /api/v1/transfers/:id/...` | `transfer_approval_events`, `transactional_outbox`, `audit_log_entries`, `enrollments` | Staff |

## 6. Roles & tenancy (high level)

- Tenant comes from the verified JWT. Cross-tenant ids return 404.
- Registrar or source principal: create, submit, cancel while the student is still at the source school.
- Receiving principal: start review, approve, reject, complete.
- Admin / super-admin / platform admin: every transition in the tenant, plus equivalency create/update/delete.
- A role assignment with `institutionId` (or `institutions[]`) can act only for that school. An empty institution list means tenant-wide for that role (the seeded tenant-admin session).
- Invalid transitions are 409. Missing equivalency on a cross-board approve, or an enrollment that is not `ENROLLED`, is 422.

## 7. Completion effect

Completion does not copy the student row onto another tenant. It sets the source enrollment to `TRANSFERRED` with an exit date, inserts a destination enrollment `ENROLLED` in the destination class/grade/period, stores that enrollment id on the transfer, and emits `student.transfer.completed`. The student's board is whatever board the destination institution is linked to.

## 8. Grade equivalency rules

Rules are tenant-scoped and keyed by source board, target board, source grade code, and source subject.

Marks conversion: `target = min(targetMax, max(0, sourceMarks * (targetMax / sourceMax) * creditFactor))`, rounded to 2 decimals.

Examples seeded for Sunrise (CBSE) and for the E2E tenant:

- CBSE Mathematics 100 → ICSE Mathematics 100, factor 1 (identity).
- CBSE Science 100 → Maharashtra State Science 80, factor 1 (75 marks → 60).
- CBSE Social Science → ICSE History & Civics is `bridge` (conversion is provisional; a bridge exam is still required).
- CBSE Hindi → ICSE is `na` when the second language does not map.

## 9. Success metrics

- Pending queue shows student and school names, not raw UUIDs.
- Submit → review → approve → complete changes enrollment status on a live Postgres database.
- Reject records a comment and does not move the enrollment.
- Another tenant cannot read the transfer.

## 10. Staff vs parent

Staff shell only. Parent and student roles are not approvers.
