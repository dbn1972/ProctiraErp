# Keycloak production realm policy (PRC-H043)

`infra/keycloak/proctira-realm.json` is the development realm import. Production must also
satisfy `infra/keycloak/proctira-realm.production-overrides.json`:

| Setting | Production value | Why |
| --- | --- | --- |
| `bruteForceProtected` | `true` (5 failures, 60 s incremental wait, max 15 min) | Account lockout independent of the gateway throttle |
| `requiredActions[CONFIGURE_TOTP].defaultAction` | `true` | Every new account enrols TOTP |
| `proctira-gateway.directAccessGrantsEnabled` | `false` | No ROPC; auth-code + PKCE only |

The gateway matches this: `AUTH_PASSWORD_GRANT` defaults to `disabled` when
`NODE_ENV=production`, so `POST /api/v1/auth/password` answers 403
`PASSWORD_GRANT_DISABLED`. If an owner re-enables ROPC (`AUTH_PASSWORD_GRANT=enabled` and
`directAccessGrantsEnabled=true`), the gateway forwards the caller's `otp` as `totp` and
Keycloak's direct-grant conditional OTP refuses tokens without it.

## Apply to the live realm (owner action, needs realm-admin credentials)

```bash
kcadm.sh config credentials --server "$KEYCLOAK_URL" --realm master --user "$KC_ADMIN"
kcadm.sh update realms/proctira \
  -s bruteForceProtected=true -s permanentLockout=false -s failureFactor=5 \
  -s waitIncrementSeconds=60 -s maxFailureWaitSeconds=900 -s maxDeltaTimeSeconds=43200
kcadm.sh update authentication/required-actions/CONFIGURE_TOTP -r proctira \
  -s enabled=true -s defaultAction=true
CID=$(kcadm.sh get clients -r proctira -q clientId=proctira-gateway --fields id --format csv --noquotes)
kcadm.sh update "clients/$CID" -r proctira -s directAccessGrantsEnabled=false
```

Verify: `kcadm.sh get realms/proctira --fields bruteForceProtected` returns `true`, and a
`POST /api/v1/auth/password` against production returns 403.

## Development realm admin (PRC-L183)

The dev realm's `india-admin` user ships without a password (required action
`UPDATE_PASSWORD`). Set one locally after import:

```bash
kcadm.sh set-password -r proctira --username india-admin --new-password "$INDIA_ADMIN_PASSWORD"
```

The previously committed India admin password must be treated as compromised: rotate it on
every live Keycloak where it was ever set (owner action).
