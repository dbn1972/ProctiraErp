/**
 * W1-SEC-02 (D2) — health App Router route guards (PHI-aware deny).
 *
 * Negative authz: portal roles without health personnel clearance must not
 * reach health page content. PHI access log is stricter than general health.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLES } from '@proctira/auth';

import { canAccessHealthRecords, canAccessPhiAccessLogs } from '@/lib/api/health';

const HEALTH_APP_DIR = join(__dirname, '../../app/(dashboard)/health');
const HEALTH_LAYOUT = join(HEALTH_APP_DIR, 'layout.tsx');
const DENY_PATTERN = /access denied|forbidden|not authorized|insufficient permissions/i;

function listHealthPageFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry === 'page.tsx') out.push(full);
    }
  }
  walk(HEALTH_APP_DIR);
  return out.sort();
}

function role(name: string) {
  return [{ roleName: name }];
}

describe('W1-SEC-02 (D2) health route guards', () => {
  describe('PHI-aware role matrix', () => {
    it('denies portal / staff roles without health clearance from health records', () => {
      for (const roleName of [
        'Parent',
        'parent',
        'Teacher',
        'teacher',
        'Administrator',
        'admin',
        'Guardian',
        'guardian',
        'Student',
        'student',
      ]) {
        expect(canAccessHealthRecords(role(roleName)), roleName).toBe(false);
      }
    });

    it('allows authorized health personnel for health records', () => {
      for (const roleName of ['NURSE', 'school_nurse', 'HEALTH_OFFICER', 'COUNSELLOR']) {
        expect(canAccessHealthRecords(role(roleName)), roleName).toBe(true);
      }
    });

    it('PHI access log denies counsellor and nurse (stricter than health records)', () => {
      expect(canAccessPhiAccessLogs(role('COUNSELLOR'))).toBe(false);
      expect(canAccessPhiAccessLogs(role('NURSE'))).toBe(false);
      expect(canAccessPhiAccessLogs(role('school_nurse'))).toBe(false);
    });

    it('PHI access log allows health admin / officer roles', () => {
      expect(canAccessPhiAccessLogs(role('HEALTH_ADMIN'))).toBe(true);
      expect(canAccessPhiAccessLogs(role('health_officer'))).toBe(true);
      expect(canAccessPhiAccessLogs(role('SYSTEM_ADMIN'))).toBe(true);
    });

    it('PHI access log matches whole role names, never substrings', () => {
      // The guard used `roleName.includes('administrator')` / `includes('health_officer')`,
      // which inverted the hierarchy the tests above describe: `Administrator` and
      // `Super Administrator` are denied ordinary health records (asserted above) and yet
      // could read the register of who viewed a child's health data. Both are shipped
      // roles in DEFAULT_ROLES, so this was reachable, not hypothetical.
      for (const roleName of [
        'Administrator',
        'Super Administrator',
        'library_administrator',
        'canteen_administrator',
        'deputy_administrator',
        'former_health_officer',
        'trainee_health_officer',
        'health_admin_trainee',
      ]) {
        expect(canAccessPhiAccessLogs(role(roleName)), roleName).toBe(false);
      }
    });

    it('no role shipped in DEFAULT_ROLES can read the PHI access log', () => {
      // Derived from the catalogue rather than copied out of it, so a seventh role that
      // happens to contain a privileged substring cannot slip past this. Before the fix
      // two of these — Administrator and Super Administrator — could read the register
      // of who viewed a child's health data.
      expect(DEFAULT_ROLES.length).toBeGreaterThan(0);
      for (const { roleName } of DEFAULT_ROLES) {
        expect(canAccessPhiAccessLogs(role(roleName)), roleName).toBe(false);
      }
    });

    it('accepts super_admin, because the gateway canonicalises SUPER_ADMIN to it', () => {
      // apps/api-gateway/src/health-ui-plugin.ts maps a SUPER_ADMIN JWT role to
      // system_admin before the health service sees it, so the API serves that user.
      // Dropping super_admin here would deny the page to someone the API answers.
      expect(canAccessPhiAccessLogs(role('super_admin'))).toBe(true);
      expect(canAccessPhiAccessLogs(role('SUPER_ADMIN'))).toBe(true);
      // The display-name spelling is not a canonical role and stays denied.
      expect(canAccessPhiAccessLogs(role('Super Administrator'))).toBe(false);
    });

    it('matches health-record roles case-insensitively, as the service now does', () => {
      // The service compares lowercase after the gateway canonicalises; the guard used
      // to enumerate both casings by hand and missed variants like School_Nurse.
      for (const roleName of ['Nurse', 'SCHOOL_NURSE', 'School_Nurse', 'Counsellor']) {
        expect(canAccessHealthRecords(role(roleName)), roleName).toBe(true);
      }
    });
  });

  describe('centralized /health layout guard', () => {
    it('health layout requires session and health-records role gate', () => {
      const src = readFileSync(HEALTH_LAYOUT, 'utf-8');
      expect(src).toContain('requireSession');
      expect(src).toContain('canAccessHealthRecords');
      expect(src).toMatch(DENY_PATTERN);
    });
  });

  describe('health page deny copy (e2e route-permission coupling)', () => {
    const phiAccessPage = join(HEALTH_APP_DIR, 'phi-access/page.tsx');

    it('phi-access page applies PHI-aware guard beyond general health layout', () => {
      const src = readFileSync(phiAccessPage, 'utf-8');
      expect(src).toContain('canAccessPhiAccessLogs');
      expect(src).toMatch(DENY_PATTERN);
    });

    it('lists every health App Router page for coverage', () => {
      expect(listHealthPageFiles().length).toBeGreaterThanOrEqual(13);
    });
  });
});
