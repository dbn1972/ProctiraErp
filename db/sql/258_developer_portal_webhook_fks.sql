-- PRC-M212: developer_portal_webhooks.account_id and
-- developer_portal_webhook_deliveries.webhook_id have no foreign keys
-- (db/sql/089: account_id / webhook_id UUID NOT NULL, no REFERENCES), so a
-- webhook can name an account that does not exist and a delivery row can point
-- at a missing webhook or at another tenant's webhook.
--
-- Fix:
--   developer_portal_webhooks_account_fk
--     FOREIGN KEY (account_id) REFERENCES developer_portal_accounts (id)
--     (accounts are platform-scoped, no tenant_id; there is no account DELETE
--     path, so NO ACTION changes no delete behaviour)
--   developer_portal_webhook_deliveries_webhook_fk
--     FOREIGN KEY (tenant_id, webhook_id)
--       REFERENCES developer_portal_webhooks (tenant_id, id) ON DELETE CASCADE
--     (tenant-composite, backed by developer_portal_webhooks_tenant_id_uidx from
--     db/sql/113; CASCADE follows the 113 signing-secret precedent: deliveries of
--     a deleted webhook are unreachable, GET /webhooks/:id/deliveries 404s)
-- Both are added NOT VALID (catalog-only, SHARE ROW EXCLUSIVE, brief), then, in
-- the same transaction, FORCE ROW LEVEL SECURITY is lifted on the three tables,
-- an anti-join orphan preflight runs (fail-closed RAISE; no data is deleted),
-- both constraints are VALIDATEd, FORCE is restored and asserted (W1-DATA-18).
--
-- Locks (PR rollout note): lifting FORCE takes ACCESS EXCLUSIVE on accounts,
-- webhooks and deliveries until COMMIT; VALIDATE scans webhooks and deliveries.
-- Bounded by apply-sql.sh's lock_timeout.
--
-- Idempotent: constraints are added only when absent; VALIDATE on a valid
-- constraint is a no-op; the orphan count is read-only.
--
-- Rollback (forward-only repo; body of a future revert migration):
--   ALTER TABLE developer_portal_webhook_deliveries
--     DROP CONSTRAINT IF EXISTS developer_portal_webhook_deliveries_webhook_fk;
--   ALTER TABLE developer_portal_webhooks
--     DROP CONSTRAINT IF EXISTS developer_portal_webhooks_account_fk;
-- Data loss on rollback: none (constraints only).

DO $prc_m212_add_fks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.developer_portal_webhooks'::regclass
       AND conname = 'developer_portal_webhooks_account_fk'
  ) THEN
    ALTER TABLE public.developer_portal_webhooks
      ADD CONSTRAINT developer_portal_webhooks_account_fk
      FOREIGN KEY (account_id) REFERENCES public.developer_portal_accounts (id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.developer_portal_webhook_deliveries'::regclass
       AND conname = 'developer_portal_webhook_deliveries_webhook_fk'
  ) THEN
    ALTER TABLE public.developer_portal_webhook_deliveries
      ADD CONSTRAINT developer_portal_webhook_deliveries_webhook_fk
      FOREIGN KEY (tenant_id, webhook_id)
      REFERENCES public.developer_portal_webhooks (tenant_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$prc_m212_add_fks$;

DO $prc_m212_validate_fks$
DECLARE
  tables CONSTANT text[] := ARRAY[
    'developer_portal_accounts',
    'developer_portal_webhooks',
    'developer_portal_webhook_deliveries'
  ];
  rel text;
  lifted text[] := ARRAY[]::text[];
  orphan_webhooks bigint;
  orphan_deliveries bigint;
  remaining text;
BEGIN
  FOREACH rel IN ARRAY tables LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = format('public.%I', rel)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rel);
      lifted := lifted || rel;
    END IF;
  END LOOP;

  SELECT count(*) INTO orphan_webhooks
    FROM public.developer_portal_webhooks w
   WHERE NOT EXISTS (
     SELECT 1 FROM public.developer_portal_accounts a WHERE a.id = w.account_id
   );
  SELECT count(*) INTO orphan_deliveries
    FROM public.developer_portal_webhook_deliveries d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.developer_portal_webhooks w
      WHERE w.id = d.webhook_id AND w.tenant_id = d.tenant_id
   );
  IF orphan_webhooks > 0 OR orphan_deliveries > 0 THEN
    RAISE EXCEPTION
      'PRC-M212: dangling references block FK validation: '
      'developer_portal_webhooks_account_fk=%; developer_portal_webhook_deliveries_webhook_fk=% '
      '(reconcile those rows, never delete tenant data blindly, then re-run)',
      orphan_webhooks, orphan_deliveries;
  END IF;

  ALTER TABLE public.developer_portal_webhooks
    VALIDATE CONSTRAINT developer_portal_webhooks_account_fk;
  ALTER TABLE public.developer_portal_webhook_deliveries
    VALIDATE CONSTRAINT developer_portal_webhook_deliveries_webhook_fk;

  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
  END LOOP;

  SELECT string_agg(conname, ', ') INTO remaining
    FROM pg_constraint
   WHERE conname IN ('developer_portal_webhooks_account_fk',
                     'developer_portal_webhook_deliveries_webhook_fk')
     AND NOT convalidated;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M212: constraints still NOT VALID: %', remaining;
  END IF;
  SELECT string_agg(relname, ', ') INTO remaining
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname = ANY (lifted)
     AND NOT relforcerowsecurity;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M212: FORCE ROW LEVEL SECURITY not restored on: %', remaining;
  END IF;
END
$prc_m212_validate_fks$;
