/**
 * G-003 — Gateway mount matrix consistency tests.
 *
 * Ensures `DOMAIN_REGISTRAR_NAMES` (exported from `domain-plugins.ts`), the
 * curated mounted/unmounted package lists, and `MOUNT_MATRIX` stay aligned.
 *
 * Registrar names are parsed from `domain-plugins.ts` source so this suite
 * does not need to load every backend package (Vitest workspace resolution).
 * The export `DOMAIN_REGISTRAR_NAMES` must still appear in that file.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXPECTED_MOUNTED,
  EXPECTED_PARKED,
  EXPECTED_UNMOUNTED,
  MATRIX_BACKEND_PACKAGES,
  MATRIX_REGISTRAR_NAMES,
  MOUNT_MATRIX,
} from './mount-matrix.js';
import { PATH_RESOURCE_MAP, resourceForApiPath, UNMAPPED_API_RESOURCE } from './rbac-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../..');
const DOMAIN_PLUGINS_SRC = join(HERE, 'domain-plugins.ts');
const BACKEND_PACKAGES_DIR = join(REPO_ROOT, 'packages/backend');
const MATRIX_DOC = join(REPO_ROOT, 'docs/audits/GATEWAY_MOUNT_MATRIX.md');

/**
 * Extract `DOMAIN_REGISTRARS` entry `name` values and confirm
 * `DOMAIN_REGISTRAR_NAMES` is exported from domain-plugins.ts.
 */
function readDomainRegistrarNamesFromSource(): string[] {
  const source = readFileSync(DOMAIN_PLUGINS_SRC, 'utf8');

  expect(source).toMatch(/export const DOMAIN_REGISTRAR_NAMES/);

  const arrayMatch = source.match(
    /const DOMAIN_REGISTRARS:\s*DomainRegistrar\[]\s*=\s*\[([\s\S]*?)\];/,
  );
  expect(arrayMatch, 'DOMAIN_REGISTRARS array not found in domain-plugins.ts').toBeTruthy();

  const body = arrayMatch![1]!;
  const names = [...body.matchAll(/\bname:\s*'([^']+)'/g)].map((m) => m[1]!);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

function listBackendPackageDirs(): string[] {
  return readdirSync(BACKEND_PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('G-003 gateway mount matrix', () => {
  const domainRegistrarNames = readDomainRegistrarNamesFromSource();

  it('exports DOMAIN_REGISTRAR_NAMES and lists unique registrar names', () => {
    expect(domainRegistrarNames.length).toBeGreaterThan(0);
    expect(new Set(domainRegistrarNames).size).toBe(domainRegistrarNames.length);
  });

  it('fails if domain-plugins adds a registrar name not in the matrix', () => {
    const matrixSet = new Set(MATRIX_REGISTRAR_NAMES);
    const missing = domainRegistrarNames.filter((name) => !matrixSet.has(name));
    expect(missing, `Add matrix rows for new registrars: ${missing.join(', ')}`).toEqual([]);
  });

  it('fails if the matrix documents a registrar not present in DOMAIN_REGISTRARS', () => {
    const liveSet = new Set(domainRegistrarNames);
    const orphaned = MATRIX_REGISTRAR_NAMES.filter((name) => !liveSet.has(name));
    expect(orphaned, `Remove stale registrar rows: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('accounts for every package in EXPECTED_MOUNTED as mounted in the matrix', () => {
    for (const pkg of EXPECTED_MOUNTED) {
      const row = MOUNT_MATRIX.find((entry) => entry.package === pkg);
      expect(row, `EXPECTED_MOUNTED package missing from MOUNT_MATRIX: ${pkg}`).toBeDefined();
      expect(row!.mounted, `${pkg} should be mounted: true`).toBe(true);
    }
  });

  it('documents every package in EXPECTED_UNMOUNTED as unmounted', () => {
    for (const pkg of EXPECTED_UNMOUNTED) {
      const row = MOUNT_MATRIX.find((entry) => entry.package === pkg);
      expect(row, `EXPECTED_UNMOUNTED package missing from MOUNT_MATRIX: ${pkg}`).toBeDefined();
      expect(row!.mounted, `${pkg} should be mounted: false`).toBe(false);
    }
  });

  it('G-605: EXPECTED_PARKED packages are unmounted with parkedReason', () => {
    expect(EXPECTED_PARKED.length).toBeGreaterThanOrEqual(4);
    for (const pkg of EXPECTED_PARKED) {
      const row = MOUNT_MATRIX.find((entry) => entry.package === pkg);
      expect(row, `PARKED package missing from matrix: ${pkg}`).toBeDefined();
      expect(row!.mounted).toBe(false);
      expect(row!.parked, `${pkg} should have parked: true`).toBe(true);
      expect(row!.parkedReason, `${pkg} needs parkedReason`).toMatch(
        /G-605|G-924|PARKED|MOUNT via/i,
      );
      expect(EXPECTED_UNMOUNTED).toContain(pkg);
    }
  });

  it('G-924: every unmounted matrix row carries a decision (no unmounted-undecided rows)', () => {
    const undecided = MOUNT_MATRIX.filter(
      (row) => !row.mounted && !(row.parked && row.parkedReason && row.parkedReason.length > 20),
    ).map((row) => row.package);
    expect(undecided, `Unmounted rows without a decision: ${undecided.join(', ')}`).toEqual([]);
    expect([...EXPECTED_PARKED].sort()).toEqual([...EXPECTED_UNMOUNTED].sort());
  });

  it('keeps EXPECTED_MOUNTED and EXPECTED_UNMOUNTED disjoint and complete vs matrix packages', () => {
    const unmounted = new Set(EXPECTED_UNMOUNTED);
    const overlap = EXPECTED_MOUNTED.filter((pkg) => unmounted.has(pkg));
    expect(overlap, `Packages in both curated lists: ${overlap.join(', ')}`).toEqual([]);

    const curated = new Set([...EXPECTED_MOUNTED, ...EXPECTED_UNMOUNTED]);
    const matrixPkgs = new Set(MATRIX_BACKEND_PACKAGES);
    const missingFromCurated = [...matrixPkgs].filter((pkg) => !curated.has(pkg));
    const extraInCurated = [...curated].filter((pkg) => !matrixPkgs.has(pkg));
    expect(
      missingFromCurated,
      `Matrix backend packages missing from curated lists: ${missingFromCurated.join(', ')}`,
    ).toEqual([]);
    expect(
      extraInCurated,
      `Curated lists reference unknown matrix packages: ${extraInCurated.join(', ')}`,
    ).toEqual([]);
  });

  it('covers every packages/backend/* directory in the matrix', () => {
    const onDisk = listBackendPackageDirs();
    const matrixPkgs = new Set(MATRIX_BACKEND_PACKAGES);
    const missing = onDisk.filter((pkg) => !matrixPkgs.has(pkg));
    const extra = [...matrixPkgs].filter((pkg) => !onDisk.includes(pkg));
    expect(missing, `Backend packages missing from matrix: ${missing.join(', ')}`).toEqual([]);
    expect(extra, `Matrix packages with no backend dir: ${extra.join(', ')}`).toEqual([]);
  });

  it('keeps GATEWAY_MOUNT_MATRIX.md present and referencing key packages', () => {
    const doc = readFileSync(MATRIX_DOC, 'utf8');
    expect(doc).toContain('Gateway mount matrix (G-003)');
    expect(doc).toContain(
      '| Package | Mounted? | Prefix(es) | Persistence | RBAC wired? | Notes |',
    );
    for (const pkg of ['student', 'auth', 'workflow', 'billing', 'audit']) {
      expect(doc, `Doc should mention ${pkg}`).toContain(`backend/${pkg}`);
    }
    for (const name of domainRegistrarNames) {
      expect(doc, `Doc should mention registrar \`${name}\``).toContain(`\`${name}\``);
    }
  });

  it('marks mounted matrix rows with at least one prefix', () => {
    for (const row of MOUNT_MATRIX.filter((entry) => entry.mounted)) {
      expect(row.prefixes.length, `${row.package} mounted but has no prefixes`).toBeGreaterThan(0);
    }
  });
});

describe('G-702 — every mounted prefix has an RBAC resource mapping (default-deny)', () => {
  it('maps each mounted MOUNT_MATRIX prefix to a resource', () => {
    const missing: string[] = [];
    for (const entry of MOUNT_MATRIX) {
      if (!entry.mounted) continue;
      for (const prefix of entry.prefixes) {
        if (prefix === '/auth') continue; // pre-login flows are excluded by design
        const resolved = resourceForApiPath(`/api/v1${prefix}/x`);
        if (!resolved || resolved === UNMAPPED_API_RESOURCE) {
          missing.push(`${entry.package}:${prefix}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('returns the default-deny sentinel for unknown segments', () => {
    expect(resourceForApiPath('/api/v1/definitely-not-mapped/1')).toBe(UNMAPPED_API_RESOURCE);
    expect(resourceForApiPath('/api/v1/services')).toBeUndefined();
    expect(Object.keys(PATH_RESOURCE_MAP).length).toBeGreaterThan(30);
  });
});
