-- P0 integration: developer-portal tenant tables are created by migration 089,
-- after the generic strict-FK repair at 082. Add and validate their tenant
-- foreign keys in a forward migration so fresh and upgraded databases converge.

DO $create_developer_portal_tenant_fks$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.developer_portal_webhooks'::regclass
       AND conname = 'developer_portal_webhooks_tenant_fk'
  ) THEN
    ALTER TABLE public.developer_portal_webhooks
      ADD CONSTRAINT developer_portal_webhooks_tenant_fk
      FOREIGN KEY (tenant_id)
      REFERENCES public.tenants(id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.developer_portal_webhook_deliveries'::regclass
       AND conname = 'developer_portal_webhook_deliveries_tenant_fk'
  ) THEN
    ALTER TABLE public.developer_portal_webhook_deliveries
      ADD CONSTRAINT developer_portal_webhook_deliveries_tenant_fk
      FOREIGN KEY (tenant_id)
      REFERENCES public.tenants(id)
      NOT VALID;
  END IF;
END
$create_developer_portal_tenant_fks$;

ALTER TABLE public.developer_portal_webhooks
  VALIDATE CONSTRAINT developer_portal_webhooks_tenant_fk;

ALTER TABLE public.developer_portal_webhook_deliveries
  VALIDATE CONSTRAINT developer_portal_webhook_deliveries_tenant_fk;

DO $assert_developer_portal_tenant_fks$
DECLARE
  invalid_constraints TEXT;
BEGIN
  WITH required(table_name, constraint_name) AS (
    VALUES
      (
        'developer_portal_webhooks',
        'developer_portal_webhooks_tenant_fk'
      ),
      (
        'developer_portal_webhook_deliveries',
        'developer_portal_webhook_deliveries_tenant_fk'
      )
  )
  SELECT string_agg(required.constraint_name, ', ' ORDER BY required.constraint_name)
    INTO invalid_constraints
    FROM required
    LEFT JOIN pg_constraint AS constraint_state
      ON constraint_state.conrelid = format('public.%I', required.table_name)::regclass
     AND constraint_state.conname = required.constraint_name
     AND constraint_state.contype = 'f'
     AND constraint_state.confrelid = 'public.tenants'::regclass
     AND constraint_state.convalidated
     AND (
       SELECT array_agg(attribute.attname::text ORDER BY key_part.ordinality)
         FROM unnest(constraint_state.conkey) WITH ORDINALITY
           AS key_part(attribute_number, ordinality)
         JOIN pg_attribute AS attribute
           ON attribute.attrelid = constraint_state.conrelid
          AND attribute.attnum = key_part.attribute_number
     ) = ARRAY['tenant_id']::text[]
   WHERE constraint_state.oid IS NULL;

  IF invalid_constraints IS NOT NULL THEN
    RAISE EXCEPTION
      'P0 integration: developer-portal tenant FK contract invalid: %',
      invalid_constraints;
  END IF;
END
$assert_developer_portal_tenant_fks$;
