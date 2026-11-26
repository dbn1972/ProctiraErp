-- PRC-L036 (Prisma layer): examination candidate registrations get a real
-- board registration number.
--
-- The candidates page could only show a fragment of the registration UUID:
-- no column held the registration number the examining board issues. This
-- adds examination_candidate_registrations.board_registration_number
-- (VARCHAR(64), NULL until recorded). The examination service accepts it on
-- candidate registration and returns it on the candidate list.
--
-- ADD COLUMN without a default is metadata-only (no rewrite, brief lock).
-- Existing registrations keep NULL ("not recorded"). Idempotent.
--
-- Rollback: forward-only. Dropping the column loses recorded numbers.
ALTER TABLE "examination_candidate_registrations"
  ADD COLUMN IF NOT EXISTS "board_registration_number" VARCHAR(64);
