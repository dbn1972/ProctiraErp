-- PRC-L576: notification delivery had no claim. processQueuedDelivery only
-- skipped rows already delivered/read, so two workers holding the same
-- notification (redelivered queue message, reclaim, retry) both called the
-- channel sender: duplicate email/SMS/push/webhook sends.
--
-- Adds a delivery lease, without touching the status enum/CHECK (005:39), so
-- the frozen status contract of twin PRC-M308 is unchanged:
--   delivery_claimed_at   TIMESTAMPTZ  when the current claim was taken
--   delivery_claim_token  UUID         the claiming attempt
-- The service claims with one conditional UPDATE
--   WHERE status NOT IN ('delivered','read')
--     AND (delivery_claimed_at IS NULL OR delivery_claimed_at < now() - lease)
-- and sends only when it wins; its result write (delivered / failed) clears
-- the claim, so a scheduled retry can claim again. An abandoned claim expires
-- after the lease (crashed worker).
--
-- Both columns are nullable metadata-only adds (no rewrite, no long lock).
-- Invariant: delivery_claim_token IS NULL <=> delivery_claimed_at IS NULL
-- (the application writes them together).
-- Rollback (future forward migration):
--   ALTER TABLE notifications DROP COLUMN IF EXISTS delivery_claim_token,
--     DROP COLUMN IF EXISTS delivery_claimed_at;
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS delivery_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_claim_token UUID;
