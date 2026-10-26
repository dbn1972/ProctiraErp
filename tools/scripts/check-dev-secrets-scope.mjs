#!/usr/bin/env node
/**
 * PRC-L475 — dev placeholder credential scope gate.
 *
 * infrastructure/k8s/overlays/development/secrets.yaml ships known
 * placeholder credentials (minioadmin, proctira_dev DB passwords, the dev
 * JWT_SECRET/COOKIE_SECRET strings) with a comment saying they must never be
 * applied to staging/prod. Nothing enforced that until this gate: it greps
 * the known dev literals across every Kustomize/Helm manifest and fails if
 * any match turns up outside infrastructure/k8s/overlays/development/.
 *
 * Usage: node tools/scripts/check-dev-secrets-scope.mjs [k8s-and-helm-dirs...]
 * Exits 1 on any violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The known dev-only placeholder literals from overlays/development/secrets.yaml. */
export const DEV_PLACEHOLDER_LITERALS = [
  'minioadmin',
  'proctira_app_dev',
  'proctira_dev',
  'dev-only-jwt-secret-not-for-production-0123456789ab',
  'dev-only-cookie-secret-not-for-production-0123456789',
];

const ALLOWED_PREFIX = 'infrastructure/k8s/overlays/development/';

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.(ya?ml)$/.test(entry)) {
      out.push(full);
    }
  }
}

export function devSecretsScopeViolations(roots, repoRoot) {
  const files = [];
  for (const root of roots) {
    try {
      walk(root, files);
    } catch {
      /* root does not exist; nothing to scan */
    }
  }
  const out = [];
  for (const file of files.sort()) {
    const rel = relative(repoRoot, file).split('\\').join('/');
    if (rel.startsWith(ALLOWED_PREFIX)) continue;
    const text = readFileSync(file, 'utf8');
    for (const literal of DEV_PLACEHOLDER_LITERALS) {
      if (text.includes(literal)) {
        out.push(
          `${rel}: contains dev-only placeholder "${literal}" outside ${ALLOWED_PREFIX} (PRC-L475)`,
        );
      }
    }
  }
  return out;
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  const repoRoot = resolve(process.argv[3] ?? '.');
  const roots =
    process.argv.length > 2
      ? [resolve(process.argv[2])]
      : [resolve(repoRoot, 'infrastructure/k8s'), resolve(repoRoot, 'infrastructure/helm')];
  let failures;
  try {
    failures = devSecretsScopeViolations(roots, repoRoot);
  } catch (err) {
    console.error(`check-dev-secrets-scope: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (failures.length > 0) {
    console.error('check-dev-secrets-scope: FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-dev-secrets-scope: PASS');
}
