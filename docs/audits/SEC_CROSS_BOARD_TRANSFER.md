# Security — cross-board transfer workflow

**Date:** 2026-09-28

## Tenancy

Every read and write filters `tenant_id` from the JWT. Another tenant's transfer id returns 404 from `MemoryTransferWorkflowStore` / `PgTransferWorkflowStore`. RLS on the new tables uses `app_tenant_id()`.

## RBAC

- Gateway maps `/transfers` to `student`. Registrar gained `student` read/list/create/update so they can open a request. They cannot edit equivalency.
- Receiving decisions require principal (destination school) or admin.
- Equivalency writes require admin, super-admin, or platform_admin (403 otherwise, even if the HTTP verb is allowed).
- Parent and teacher cannot create transfers (teacher lacks `student:create`; parent read of the queue is 403 in the service).
- Institution scope: a role assignment with `institutionId` cannot approve a school outside that list.

## Audit

Each transition inserts `audit_log_entries` (operation UPDATE, before/after workflow status). Completion also inserts `student.transfer.completed` on `transactional_outbox` in the same transaction.

## Evidence

`packages/backend/student/src/transfers/routes.test.ts` and `apps/api-gateway/src/transfer-workflow-authz.test.ts` cover 403, 404, 409, and 422. Live enrollment move is the Playwright spec under `E2E_BACKEND_READY=1`.
