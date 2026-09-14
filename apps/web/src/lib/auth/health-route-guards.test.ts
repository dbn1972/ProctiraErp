/**
 * W1-SEC-02 (D2) — health App Router route guards (PHI-aware deny).
 *
 * Negative authz: portal roles without health personnel clearance must not
 * reach health page content. PHI access log is stricter than general health.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canAccessHealthRecords,
  canAccessPhiAccessLogs,
} from '@/lib/api/health';

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
