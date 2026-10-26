#!/usr/bin/env node
/**
 * PRC-M598 — HPA / replicas anti-pattern gate for the platform Helm chart.
 *
 * A Deployment template that has a sibling `hpa.yaml` targeting the same
 * Deployment must NOT set `spec.replicas` unconditionally: every
 * `helm upgrade` would otherwise reset the live HPA-scaled replica count
 * back to `.replicaCount`, fighting the autoscaler. The fix is the standard
 * Helm guard:
 *
 *   {{- if not .Values.<key>.autoscaling.enabled }}
 *   replicas: {{ .Values.<key>.replicaCount }}
 *   {{- end }}
 *
 * Rule: for every `infrastructure/helm/proctira-platform/templates/<dir>/
 * deployment.yaml` that has a sibling `hpa.yaml`, the `replicas:` line (if
 * present) must be preceded by an `{{- if not ... autoscaling.enabled }}`
 * guard line. Templates with no sibling `hpa.yaml` (admin-console,
 * developer-portal) are expected to keep their unconditional `replicas:`
 * line and are not checked.
 *
 * Usage: node tools/scripts/check-hpa-replica-guard.mjs [platform-templates-dir]
 * Exits 1 on any violation.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function findHpaGuardedDirs(templatesDir) {
  const out = [];
  for (const entry of readdirSync(templatesDir)) {
    const dir = join(templatesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const deployment = join(dir, 'deployment.yaml');
    const hpa = join(dir, 'hpa.yaml');
    if (existsSync(deployment) && existsSync(hpa)) {
      out.push({ name: entry, deployment, hpa });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the unconditional `replicas:` line is immediately preceded by
 * an `{{- if not ... autoscaling.enabled }}` guard (allowing blank/comment
 * lines in between is intentionally not supported — keep the guard tight). */
export function hasReplicaGuard(deploymentText) {
  const lines = deploymentText.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*replicas:\s*\{\{/.test(lines[i])) {
      const prev = lines[i - 1] ?? '';
      return /\{\{-?\s*if\s+not\s+\.Values\.\S+\.autoscaling\.enabled\s*\}\}/.test(prev);
    }
  }
  // No `replicas:` line at all is also safe (e.g. relies entirely on HPA).
  return true;
}

export function hpaReplicaGuardViolations(templatesDir) {
  const out = [];
  for (const { name, deployment } of findHpaGuardedDirs(templatesDir)) {
    const text = readFileSync(deployment, 'utf8');
    if (!hasReplicaGuard(text)) {
      out.push(
        `${deployment}: "${name}" has a sibling hpa.yaml but sets replicas unconditionally; ` +
          'wrap it in {{- if not .Values.<key>.autoscaling.enabled }} / {{- end }} (PRC-M598)',
      );
    }
  }
  return out;
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  const templatesDir = resolve(
    process.argv[2] ?? 'infrastructure/helm/proctira-platform/templates',
  );
  let failures;
  try {
    failures = hpaReplicaGuardViolations(templatesDir);
  } catch (err) {
    console.error(`check-hpa-replica-guard: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (failures.length > 0) {
    console.error('check-hpa-replica-guard: FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-hpa-replica-guard: PASS');
}
