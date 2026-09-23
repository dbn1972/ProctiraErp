/**
 * W1-SEC-02 (D2) — health App Router route guards (PHI-aware deny).
 *
 * Negative authz: portal roles without health personnel clearance must not
 * reach health page content. PHI access log is stricter than general health.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
      // Every roleName in @proctira/auth DEFAULT_ROLES. None of them is health
      // personnel, so none may audit PHI access. Before this change, two could.
      for (const roleName of [
        'Super Administrator',
        'Administrator',
        'Principal',
        'Teacher',
        'Staff',
        'Guardian',
      ]) {
        expect(canAccessPhiAccessLogs(role(roleName)), roleName).toBe(false);
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
