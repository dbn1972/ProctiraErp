#!/usr/bin/env node
/**
 * NEW-g3_infra_tools-001 (PRC-M279 extension) — least-privilege secret scope
 * for workloads under infrastructure/k8s/base.
 *
 * The full `proctira-secrets` bundle carries JWT_SECRET, JWT_SECRET_PREVIOUS,
 * COOKIE_SECRET, PHI_ENCRYPTION_KEY and the S3 keys. A worker that only reads a
 * DB URL and a broker URL must never receive the JWT signing key or the PHI
 * encryption key: an RCE in a document-rendering worker would otherwise yield
 * tenant token forgery + PHI decryption. etl-worker was fixed for PRC-M279;
 * this gate keeps every worker (and any new workload) honest.
 *
 * Rule:
 *   - A Deployment whose `app.kubernetes.io/component` is `worker` MUST NOT
 *     envFrom the whole `proctira-secrets` Secret. It must use explicit
 *     `valueFrom.secretKeyRef` entries for the keys its code reads.
 *   - Any other Deployment that envFroms the full bundle must be on the
 *     explicit FULL_BUNDLE_ALLOWLIST (fail closed for new workloads). The
 *     api-gateway hosts every domain in-process and the lab-only split-domain
 *     services are the sole justified consumers.
 *
 * Usage: node tools/scripts/check-worker-secret-scope.mjs [k8s-base-dir]
 * Exits 1 on any violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FULL_BUNDLE_SECRET = 'proctira-secrets';

/**
 * Workloads that legitimately need the whole bundle. api-gateway runs all
 * domain packages in-process; the *-service names are lab-only split domains
 * (W1-OPS-16) that each host a backend domain. Workers are intentionally
 * excluded — they must scope keys per-key.
 */
export const FULL_BUNDLE_ALLOWLIST = new Set([
  'api-gateway',
  'institution-service',
  'student-service',
  'staff-service',
  'assessment-service',
  'attendance-service',
  'examination-service',
  'workflow-service',
  'notification-service',
  'report-service',
]);

/** Minimal structural read of a single-document Deployment YAML. */
export function parseDeployment(text) {
  const name = (text.match(/^metadata:\s*\n(?:\s+.*\n)*?\s+name:\s*(\S+)/m) || [])[1];
  const component = (text.match(/app\.kubernetes\.io\/component:\s*(\S+)/) || [])[1];
  // Detect an envFrom entry that references the whole bundle via secretRef.
  // (valueFrom.secretKeyRef uses `name:` too, so key off the `secretRef:` block.)
  let envFromFullBundle = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*-?\s*secretRef:\s*$/.test(lines[i])) {
      // Look ahead a few lines for `name: proctira-secrets` under secretRef.
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
        if (/^\s*name:\s*proctira-secrets\s*$/.test(lines[j])) {
          envFromFullBundle = true;
          break;
        }
        if (/^\s*-\s/.test(lines[j]) || /:\s*$/.test(lines[j])) break;
      }
    }
  }
  return { name, component, envFromFullBundle };
}

export function findDeploymentFiles(baseDir) {
  const out = [];
  for (const entry of readdirSync(baseDir)) {
    const dir = join(baseDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const dep = join(dir, 'deployment.yaml');
    try {
      if (statSync(dep).isFile()) out.push(dep);
    } catch {
      /* no deployment.yaml in this dir */
    }
  }
  return out.sort();
}

export function workerSecretScopeViolations(baseDir) {
  const out = [];
  for (const file of findDeploymentFiles(baseDir)) {
    const { name, component, envFromFullBundle } = parseDeployment(readFileSync(file, 'utf8'));
    if (!envFromFullBundle) continue;
    const id = name || file;
    if (component === 'worker') {
      out.push(
        `${file}: worker "${id}" envFroms the full ${FULL_BUNDLE_SECRET} bundle; ` +
          'use valueFrom.secretKeyRef for only the keys its code reads (like etl-worker)',
      );
    } else if (!FULL_BUNDLE_ALLOWLIST.has(id)) {
      out.push(
        `${file}: workload "${id}" envFroms the full ${FULL_BUNDLE_SECRET} bundle but is not on ` +
          'the FULL_BUNDLE_ALLOWLIST; scope its secrets per-key or justify + allowlist it',
      );
    }
  }
  return out;
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  const baseDir = resolve(process.argv[2] ?? 'infrastructure/k8s/base');
  let failures;
  try {
    failures = workerSecretScopeViolations(baseDir);
  } catch (err) {
    console.error(`check-worker-secret-scope: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (failures.length > 0) {
    console.error('check-worker-secret-scope: FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-worker-secret-scope: PASS');
}
