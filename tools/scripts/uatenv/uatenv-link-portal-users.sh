#!/usr/bin/env bash
# Link the UAT portal users to Sunrise records so the parent and student portals show data.
#   uatenv-link-portal-users.sh
# The gateway creates a local user id for a Keycloak user on that user's first login, so this
#   1. signs uat-parent and uat-student in once through the gateway password route
#      (POST /api/v1/auth/password; credentials read in-process from uat-users.tsv, never on argv);
#   2. reads their local user ids from control_plane_documents (auth.keycloak_users);
#   3. as the migrator, with app.tenant_id bound to Sunrise, adds uat-parent to the student's
#      custody household and an active parent_child_links row (uat-parent ->
#      UATENV_PORTAL_STUDENT_ID), and sets that student's custom_data.user_id to the
#      uat-student local id (the PRC-H075 self-binding the student portal reads).
# Idempotent. Run after the apps are healthy (deploy apps stage, reset-data).
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"
load_env_file "$UATENV_SEC/ops.env"
TENANT_ID="${UATENV_PORTAL_TENANT_ID:-00000000-0000-4000-8000-00000000a501}"
STUDENT_ID="${UATENV_PORTAL_STUDENT_ID:-00000000-0000-4000-8000-00000000a5b1}"
GATEWAY="${UATENV_GATEWAY_DIRECT:-http://127.0.0.1:29030}"
USERS_FILE="$UATENV_SEC/uat-users.tsv"
[[ -r "$USERS_FILE" ]] || uatenv_die "missing $USERS_FILE (run the keycloak stage first)"

uatenv_log "provisioning local identities for uat-parent and uat-student (gateway password login)"
USERS_FILE="$USERS_FILE" GATEWAY="$GATEWAY" python3 - <<'PY'
import csv, json, os, sys, urllib.request, urllib.error
rows = list(csv.DictReader(open(os.environ["USERS_FILE"]), delimiter="\t"))
for prefix in ("uat-parent@", "uat-student@"):
    row = next((r for r in rows if r["username"].startswith(prefix)), None)
    if row is None:
        sys.exit(f"{prefix} user missing from uat-users.tsv")
    req = urllib.request.Request(
        os.environ["GATEWAY"] + "/api/v1/auth/password",
        data=json.dumps({"username": row["username"], "password": row["password"]}).encode(),
        headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status = res.status
    except urllib.error.HTTPError as e:
        status = e.code
    print(f"  {prefix.rstrip('@')}: gateway password login HTTP {status}")
    if status != 200:
        sys.exit(1)
PY

uatenv_psql "$MIGRATOR_DATABASE_URL" -q -At -v ON_ERROR_STOP=1 \
  -v tenant_id="$TENANT_ID" -v student_id="$STUDENT_ID" <<'SQL'
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_id', true) \g /dev/null
CREATE TEMP TABLE uatenv_portal_ids ON COMMIT DROP AS
SELECT split_part(id, ':', 2) AS email, data->>'id' AS user_id
  FROM control_plane_documents
 WHERE collection = 'auth.keycloak_users'
   AND tenant_id::text = :'tenant_id'
   AND split_part(id, ':', 2) IN ('uat-parent@proctira-uat.test', 'uat-student@proctira-uat.test');
DO $$
BEGIN
  IF (SELECT count(*) FROM uatenv_portal_ids WHERE user_id IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'uat-parent / uat-student local identities not found';
  END IF;
END $$;
-- The parent portal serves a link only when the parent is an active member of a household
-- that holds active custody of the student (fail closed otherwise), so join that household.
CREATE TEMP TABLE uatenv_custody ON COMMIT DROP AS
SELECT household_id FROM guardian_student_custody
 WHERE tenant_id = :'tenant_id'::uuid AND student_id = :'student_id'::uuid AND status = 'active'
 ORDER BY created_at LIMIT 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uatenv_custody) THEN
    RAISE EXCEPTION 'portal student has no active custody household';
  END IF;
END $$;
INSERT INTO guardian_household_members (id, tenant_id, household_id, parent_user_id, role, status)
SELECT gen_random_uuid(), :'tenant_id'::uuid, c.household_id, p.user_id, 'guardian', 'active'
  FROM uatenv_portal_ids p CROSS JOIN uatenv_custody c
 WHERE p.email = 'uat-parent@proctira-uat.test'
ON CONFLICT (tenant_id, household_id, parent_user_id) DO UPDATE SET status = 'active';
INSERT INTO parent_child_links (id, tenant_id, parent_user_id, student_id, relationship, status,
                                is_primary, can_consent_medical, can_view_fees, household_id)
SELECT gen_random_uuid(), :'tenant_id'::uuid, p.user_id, :'student_id'::uuid, 'guardian', 'active',
       true, true, true, c.household_id
  FROM uatenv_portal_ids p CROSS JOIN uatenv_custody c
 WHERE p.email = 'uat-parent@proctira-uat.test'
ON CONFLICT (tenant_id, parent_user_id, student_id)
  DO UPDATE SET status = 'active', household_id = EXCLUDED.household_id;
UPDATE students s
   SET custom_data = coalesce(s.custom_data, '{}'::jsonb) || jsonb_build_object('user_id', p.user_id)
  FROM uatenv_portal_ids p
 WHERE p.email = 'uat-student@proctira-uat.test'
   AND s.tenant_id = :'tenant_id'::uuid AND s.id = :'student_id'::uuid;
SELECT 'parent links: ' || count(*) FROM parent_child_links l JOIN uatenv_portal_ids p
    ON p.user_id = l.parent_user_id WHERE l.status = 'active';
SELECT 'student self-binding rows: ' || count(*) FROM students s JOIN uatenv_portal_ids p
    ON s.custom_data->>'user_id' = p.user_id WHERE s.tenant_id = :'tenant_id'::uuid;
COMMIT;
SQL
uatenv_log "portal users linked to student $STUDENT_ID"
