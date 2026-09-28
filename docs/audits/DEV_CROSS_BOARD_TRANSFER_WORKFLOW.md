# Development checklist — cross-board transfer workflow

**Slice:** approval state machine, equivalency, enrollment move  
**Date:** 2026-09-28

## Product contract

See `docs/audits/PRODUCT_CROSS_BOARD_TRANSFER.md`.

## Domain

- Migration `db/sql/104_cross_board_transfer_workflow.sql`
- States enforced in `packages/backend/student/src/transfers/state-machine.ts`
- Completion updates `enrollments` and writes `transactional_outbox` + `audit_log_entries` in one `withPgTenant` transaction (`pg-store.ts`)
- Legacy `POST /enrollments/transfer` still records an immediate completed move

## API

Mounted by `studentPlugin`:

- `POST /api/v1/transfers`
- `GET /api/v1/transfers/pending`
- `POST /api/v1/transfers/:id/{submit,review,approve,reject,cancel,complete}`
- `GET/POST /api/v1/transfers/equivalency` and `PATCH/DELETE /api/v1/transfers/equivalency/:id`
- Existing `GET /api/v1/transfers/:id` now returns approvals, equivalency, and capabilities

## UI

- Staff App Router: `/transfers`, `/transfers/[id]`
- Dashboard feature: `CrossBoardTransferDashboard` pending list and decision actions

## Non-goals kept

No transfer-certificate PDF changes. No parent shell.
