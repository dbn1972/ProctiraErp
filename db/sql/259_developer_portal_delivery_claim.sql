-- PRC-L464: webhook delivery processing has no claim / lease, so two workers
-- (or a redelivered queue message after a crash) can both POST the same
-- pending delivery. The service only skipped terminal states.
--
-- Fix: two nullable lease columns on developer_portal_webhook_deliveries. A
-- worker claims a delivery with one conditional UPDATE under the tenant
-- (status = 'pending' AND (claimed_at IS NULL OR claimed_at < now() - lease));
-- only the winner sends, and writing the result clears the claim. A crashed
-- worker's claim expires after the lease (default 5 min) and the row can be
-- reclaimed. No index: the claim looks the row up by primary key.
--
-- ADD COLUMN without a default is catalog-only (no rewrite, brief ACCESS
-- EXCLUSIVE). Transactional file. Idempotent (IF NOT EXISTS).
--
-- Rollback (forward-only repo; body of a future revert migration):
--   ALTER TABLE developer_portal_webhook_deliveries
--     DROP COLUMN IF EXISTS claim_token, DROP COLUMN IF EXISTS claimed_at;
-- Data loss on rollback: only transient lease state.

ALTER TABLE developer_portal_webhook_deliveries
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_token UUID;

COMMENT ON COLUMN developer_portal_webhook_deliveries.claimed_at IS
  'PRC-L464: when a delivery worker claimed this row; NULL when unclaimed. Lease expires after DeveloperPortalServiceConfig.deliveryClaimLeaseMs.';
COMMENT ON COLUMN developer_portal_webhook_deliveries.claim_token IS
  'PRC-L464: token of the worker holding the claim; cleared when the attempt result is written.';
