-- PRC-M335: admission_enquiries had no concurrency token. updateEnquiry was a
-- read-merge-write (`UPDATE ... WHERE tenant_id AND id`), so a stale writer
-- silently overwrote a newer edit, and convertEnquiry checked application_id
-- in the app, then created an application, then wrote the enquiry, so N
-- concurrent conversions created N admission_applications rows.
--
-- The application now:
--   * updates with `SET ..., version = version + 1 WHERE tenant_id AND id AND
--     version = <expected>`; zero rows -> ConflictError (409);
--   * claims a conversion before creating the application, with a conditional
--     UPDATE (`application_id IS NOT DISTINCT FROM <seen> AND no unexpired
--     claim`) that stores the application id it is about to create in
--     conversion_claim_id. application_id itself cannot hold that id yet: it
--     has a FK to admission_applications (034), and the application is created
--     by a different repository in a separate transaction. Once the
--     application exists, one UPDATE sets application_id + stage 'applied' and
--     clears the claim; a failed create clears the claim. conversion_claimed_at
--     is a lease so a crashed caller cannot block conversion forever.
--
-- All three columns are metadata-only adds on PG11+ (constant / NULL default):
-- no table rewrite, no long lock. conversion_claim_id deliberately has no FK
-- (it names an application that does not exist yet).
-- Merit-list regeneration already serialises on the merit_lists ON CONFLICT
-- row lock (pg-pipeline-store.ts replaceMeritList); no schema change for it.
--
-- Invariants: version increases on every application write; a non-null
-- conversion_claim_id always has a conversion_claimed_at.
-- Rollback (future forward migration):
--   ALTER TABLE admission_enquiries DROP COLUMN IF EXISTS conversion_claimed_at,
--     DROP COLUMN IF EXISTS conversion_claim_id, DROP COLUMN IF EXISTS version;
ALTER TABLE admission_enquiries
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_claim_id UUID,
  ADD COLUMN IF NOT EXISTS conversion_claimed_at TIMESTAMPTZ;
