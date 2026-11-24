#!/usr/bin/env bash
# Keycloak realm deltas and UAT role users (idempotent; run after every deploy).
#
#   uatenv-keycloak.sh            apply realm/client/role deltas + user profile + users
#   uatenv-keycloak.sh --verify   direct-grant token check for every user (claim names only)
#
# `--import-realm` skips an existing realm, so the client, roles and security
# settings from the rendered realm (secrets/generated/keycloak-realm.json) are
# re-applied here through the admin REST API on 127.0.0.1:29020.
# Users: one per catalogue role (see ROLE_USERS). Passwords are generated once
# and kept in secrets/uat-users.tsv (mode 600); they are never printed.
# Admin credentials, tokens and passwords reach curl through `--config -`
# (stdin) or mode-600 temp files, never argv.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

load_env_file "$UATENV_SEC/uatenv.env"
KC="${UATENV_KEYCLOAK_ADMIN_URL:-http://127.0.0.1:29020}"
REALM="${KEYCLOAK_REALM:-proctira}"
USERS_TSV="$UATENV_SEC/uat-users.tsv"
RENDERED_REALM="$UATENV_SEC/generated/keycloak-realm.json"
SUNRISE_ID=00000000-0000-4000-8000-00000000a501
TENANT_B_ID=00000000-0000-4000-8000-000000000001
TENANT_BASE="${UATENV_TENANT_BASE_DOMAIN:-proctira.localhost}"
PORT_SUFFIX=":${UATENV_PUBLIC_PORT:-29080}"
SCHEME="${UATENV_PUBLIC_SCHEME:-http}"
[[ "$SCHEME:${UATENV_PUBLIC_PORT:-29080}" == "https:443" ]] && PORT_SUFFIX=''

# username-prefix | realm role | tenant slug | tenant id | display name
ROLE_USERS=(
  "uat-platform-admin|super-admin|sunrise-public-school|$SUNRISE_ID|Platform Admin"
  "uat-tenant-admin|admin|sunrise-public-school|$SUNRISE_ID|Tenant Admin"
  "uat-principal|principal|sunrise-public-school|$SUNRISE_ID|Principal"
  "uat-teacher|teacher|sunrise-public-school|$SUNRISE_ID|Teacher"
  "uat-staff|staff|sunrise-public-school|$SUNRISE_ID|Office Staff"
  "uat-bursar|bursar|sunrise-public-school|$SUNRISE_ID|Bursar"
  "uat-registrar|registrar|sunrise-public-school|$SUNRISE_ID|Registrar"
  "uat-warden|warden|sunrise-public-school|$SUNRISE_ID|Hostel Warden"
  "uat-transport-officer|transport_officer|sunrise-public-school|$SUNRISE_ID|Transport Officer"
  "uat-nurse|nurse|sunrise-public-school|$SUNRISE_ID|School Nurse"
  "uat-librarian|librarian|sunrise-public-school|$SUNRISE_ID|Librarian"
  "uat-parent|guardian|sunrise-public-school|$SUNRISE_ID|Parent"
  "uat-student|student|sunrise-public-school|$SUNRISE_ID|Student"
  "uat-b-tenant-admin|admin|e2e-tenant-a|$TENANT_B_ID|Tenant B Admin"
  "uat-b-teacher|teacher|e2e-tenant-a|$TENANT_B_ID|Tenant B Teacher"
)
USER_DOMAIN="${UATENV_USER_DOMAIN:-proctira-uat.test}"

TMP="$(mktemp -d "$UATENV_SEC/.kc.XXXXXX")"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT
TOKEN=''

kc_token() {
  TOKEN="$(
    printf 'url = "%s/realms/master/protocol/openid-connect/token"\ndata-urlencode = "grant_type=password"\ndata-urlencode = "client_id=admin-cli"\ndata-urlencode = "username=%s"\ndata-urlencode = "password=%s"\n' \
      "$KC" "$KEYCLOAK_ADMIN" "$KEYCLOAK_ADMIN_PASSWORD" \
      | curl -sS --fail --config - \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
  )" || uatenv_die "could not get a Keycloak admin token from $KC"
}

# kc METHOD PATH [BODY_FILE] -> body on stdout; fails on HTTP >= 400.
kc() {
  local method="$1" path="$2" body="${3:-}" code
  local args=(-sS -o "$TMP/resp" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json')
  [[ -n "$body" ]] && args+=(--data-binary "@$body")
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl "${args[@]}" --config - "$KC/admin/realms/$REALM$path")"
  if [[ "$code" -ge 400 ]]; then
    uatenv_log "Keycloak $method $path -> HTTP $code: $(head -c 300 "$TMP/resp")"
    return 1
  fi
  cat "$TMP/resp"
}

json_body() { # json_body FILE PYTHON_EXPR_PRINTING_JSON  (env vars in, file mode 600 out)
  local file="$1"
  shift
  (umask 077 && python3 -c "$1" >"$file")
}

apply_realm_deltas() {
  [[ -f "$RENDERED_REALM" ]] || uatenv_die "rendered realm missing: $RENDERED_REALM"
  uatenv_log "realm security settings"
  REALM_FILE="$RENDERED_REALM" json_body "$TMP/realm.json" '
import json, os
r = json.load(open(os.environ["REALM_FILE"]))
keys = ["sslRequired", "bruteForceProtected", "permanentLockout", "failureFactor", "passwordPolicy", "registrationAllowed"]
print(json.dumps({k: r[k] for k in keys if k in r}))'
  kc PUT "" "$TMP/realm.json" >/dev/null

  uatenv_log "realm roles"
  local role
  for role in $(python3 -c 'import json,sys; print(" ".join(x["name"] for x in json.load(open(sys.argv[1]))["roles"]["realm"]))' "$RENDERED_REALM"); do
    if ! kc GET "/roles/$role" >/dev/null 2>&1; then
      ROLE="$role" json_body "$TMP/role.json" 'import json,os; print(json.dumps({"name": os.environ["ROLE"], "description": "UAT catalogue role " + os.environ["ROLE"]}))'
      kc POST /roles "$TMP/role.json" >/dev/null
      uatenv_log "  created role $role"
    fi
  done

  uatenv_log "client proctira-gateway (secret, redirect URIs, web origins)"
  local cid
  cid="$(kc GET '/clients?clientId=proctira-gateway' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if d else "")')"
  [[ -n "$cid" ]] || uatenv_die "client proctira-gateway not found in realm $REALM"
  kc GET "/clients/$cid" >"$TMP/client-current.json"
  REALM_FILE="$RENDERED_REALM" CUR="$TMP/client-current.json" json_body "$TMP/client.json" '
import json, os
want = next(c for c in json.load(open(os.environ["REALM_FILE"]))["clients"] if c["clientId"] == "proctira-gateway")
cur = json.load(open(os.environ["CUR"]))
for k in ["secret", "redirectUris", "webOrigins"]:
    cur[k] = want[k]
cur.setdefault("attributes", {})["post.logout.redirect.uris"] = want["attributes"]["post.logout.redirect.uris"]
print(json.dumps(cur))'
  rm -f "$TMP/client-current.json"
  kc PUT "/clients/$cid" "$TMP/client.json" >/dev/null

  uatenv_log "user profile: unmanaged attributes ADMIN_EDIT (tenant_id/tenant_slug kept, not user-editable)"
  kc GET /users/profile >"$TMP/profile.json"
  CUR="$TMP/profile.json" json_body "$TMP/profile-new.json" '
import json, os
p = json.load(open(os.environ["CUR"]))
p["unmanagedAttributePolicy"] = "ADMIN_EDIT"
print(json.dumps(p))'
  kc PUT /users/profile "$TMP/profile-new.json" >/dev/null
}

new_password() { openssl rand -base64 18 | tr '+/' 'kq'; }

tsv_password() { # existing password for username, if any
  [[ -f "$USERS_TSV" ]] || return 0
  awk -F'\t' -v u="$1" '$1 == u { print $5 }' "$USERS_TSV"
}

apply_users() {
  local out="$TMP/users.tsv" spec prefix role slug tid name username pw uid host
  (umask 077 && printf 'username\trole\ttenant_slug\tlogin_host\tpassword\n' >"$out")
  for spec in "${ROLE_USERS[@]}"; do
    IFS='|' read -r prefix role slug tid name <<<"$spec"
    username="$prefix@$USER_DOMAIN"
    host="$SCHEME://$slug.$TENANT_BASE$PORT_SUFFIX"
    pw="$(tsv_password "$username")"
    [[ -n "$pw" ]] || pw="$(new_password)"
    U_NAME="$username" U_SLUG="$slug" U_TID="$tid" U_DISPLAY="$name" json_body "$TMP/user.json" '
import json, os
first, _, last = os.environ["U_DISPLAY"].partition(" ")
print(json.dumps({
  "username": os.environ["U_NAME"], "email": os.environ["U_NAME"], "emailVerified": True,
  "enabled": True, "firstName": "UAT " + first, "lastName": last or "User",
  "attributes": {"tenant_id": [os.environ["U_TID"]], "tenant_slug": [os.environ["U_SLUG"]]},
  "requiredActions": [],
}))'
    uid="$(kc GET "/users?username=$username&exact=true" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if d else "")')"
    if [[ -z "$uid" ]]; then
      kc POST /users "$TMP/user.json" >/dev/null
      uid="$(kc GET "/users?username=$username&exact=true" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')"
      uatenv_log "  created $username ($role)"
    else
      kc PUT "/users/$uid" "$TMP/user.json" >/dev/null
      uatenv_log "  updated $username ($role)"
    fi
    U_PW="$pw" json_body "$TMP/pw.json" 'import json,os; print(json.dumps({"type": "password", "value": os.environ["U_PW"], "temporary": False}))'
    kc PUT "/users/$uid/reset-password" "$TMP/pw.json" >/dev/null
    rm -f "$TMP/pw.json"
    kc GET "/roles/$role" >"$TMP/role-rep.json"
    python3 -c 'import json,sys; print(json.dumps([json.load(open(sys.argv[1]))]))' "$TMP/role-rep.json" >"$TMP/role-list.json"
    kc POST "/users/$uid/role-mappings/realm" "$TMP/role-list.json" >/dev/null
    printf '%s\t%s\t%s\t%s\t%s\n' "$username" "$role" "$slug" "$host" "$pw" >>"$out"
  done
  mv "$out" "$USERS_TSV"
  chmod 600 "$USERS_TSV"
  uatenv_log "credentials file written: $USERS_TSV ($(($(wc -l <"$USERS_TSV") - 1)) users, mode 600)"
}

verify_users() {
  [[ -f "$USERS_TSV" ]] || uatenv_die "no users file: $USERS_TSV"
  local fails=0 username role slug host pw
  while IFS=$'\t' read -r username role slug host pw; do
    [[ "$username" == username ]] && continue
    local result
    result="$(
      printf 'url = "%s/realms/%s/protocol/openid-connect/token"\ndata-urlencode = "grant_type=password"\ndata-urlencode = "client_id=%s"\ndata-urlencode = "client_secret=%s"\ndata-urlencode = "username=%s"\ndata-urlencode = "password=%s"\ndata-urlencode = "scope=openid"\n' \
        "$KC" "$REALM" "$KEYCLOAK_CLIENT_ID" "$KEYCLOAK_CLIENT_SECRET" "$username" "$pw" \
        | curl -sS --config - \
        | EXPECT_ISS="$KEYCLOAK_ISSUER" EXPECT_ROLE="$role" EXPECT_SLUG="$slug" python3 -c '
import base64, json, os, sys
d = json.load(sys.stdin)
if "access_token" not in d:
    print("FAIL no token: " + str(d.get("error", "?")))
    sys.exit(0)
seg = d["access_token"].split(".")[1]
p = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
roles = p.get("realm_access", {}).get("roles", [])
checks = {
  "iss": p.get("iss") == os.environ["EXPECT_ISS"],
  "tenant_id": bool(p.get("tenant_id")),
  "tenant_slug": p.get("tenant_slug") == os.environ["EXPECT_SLUG"],
  "role": os.environ["EXPECT_ROLE"] in roles,
}
ok = all(checks.values())
print(("PASS" if ok else "FAIL") + " " + " ".join(k + "=" + ("ok" if v else "missing") for k, v in checks.items())
      + " claims=" + ",".join(sorted(p.keys())))'
    )"
    printf '%-48s %-18s %s\n' "$username" "$role" "$result"
    [[ "$result" == PASS* ]] || fails=$((fails + 1))
  done <"$USERS_TSV"
  ((fails == 0)) || uatenv_die "$fails user(s) failed the direct-grant check"
  uatenv_log "all users obtained a token with iss, tenant_id, tenant_slug and their role"
}

kc_token
case "${1:-}" in
  --verify) verify_users ;;
  '')
    apply_realm_deltas
    apply_users
    ;;
  *) uatenv_die "usage: uatenv-keycloak.sh [--verify]" ;;
esac
