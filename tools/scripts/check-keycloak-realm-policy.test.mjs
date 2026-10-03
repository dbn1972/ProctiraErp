// PRC-H043: realm exports keep brute-force detection + OTP, and the production overrides
// disable ROPC and require TOTP enrolment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

test('dev realm enables brute-force detection and a TOTP OTP policy', () => {
  const realm = read('infra/keycloak/proctira-realm.json');
  assert.equal(realm.bruteForceProtected, true);
  assert.ok(realm.failureFactor > 0 && realm.failureFactor <= 10);
  assert.equal(realm.otpPolicyType, 'totp');
  const totp = realm.requiredActions.find((a) => a.alias === 'CONFIGURE_TOTP');
  assert.equal(totp?.enabled, true);
});

test('production overrides: lockout on, TOTP default action, no direct access grants', () => {
  const prod = read('infra/keycloak/proctira-realm.production-overrides.json');
  assert.equal(prod.bruteForceProtected, true);
  assert.equal(prod.permanentLockout, false);
  const totp = prod.requiredActions.find((a) => a.alias === 'CONFIGURE_TOTP');
  assert.equal(totp?.defaultAction, true);
  const gateway = prod.clients.find((c) => c.clientId === 'proctira-gateway');
  assert.equal(gateway?.directAccessGrantsEnabled, false);
});
