-- P0 integration forward fix: API-key authentication starts from a secret
-- hash before a trusted tenant is known. Keep ID-based management under the
-- tenant policy and permit only the read path used by hash authentication in
-- a transaction-local platform scope.

DROP POLICY IF EXISTS platform_api_key_lookup ON public.developer_portal_api_keys;
CREATE POLICY platform_api_key_lookup ON public.developer_portal_api_keys
  FOR SELECT
  USING (NULLIF(current_setting('app.platform_admin', true), '') = '1');

DO $assert_developer_portal_api_key_lookup$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'developer_portal_api_keys'
       AND policyname = 'platform_api_key_lookup'
       AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'P0 integration: developer portal platform API-key lookup policy is missing';
  END IF;
END
$assert_developer_portal_api_key_lookup$;
