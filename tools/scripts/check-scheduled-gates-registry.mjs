#!/usr/bin/env node
/**
 * PRC-L108 — every scheduled workflow is watched by the scheduled-gates watchdog.
 *
 * Fails when a `.github/workflows/*.yml` file has a `schedule:` trigger but is
 * not listed in tools/scripts/scheduled-gates.json (gates or exempt), or when a
 * registry entry names a workflow file that does not exist or has no
 * `schedule:` trigger.
 *
 * Dependency-free (node: built-ins only, line scan) because it runs in the
 * workflow-lint job, which has no `pnpm install`.
 *
 * Usage: node tools/scripts/check-scheduled-gates-registry.mjs [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REGISTRY_REL = 'tools/scripts/scheduled-gates.json';
const WORKFLOWS_REL = '.github/workflows';

/**
 * True when the workflow text declares a `schedule:` trigger under `on:`.
 * Line scan: a `schedule:` key indented under a top-level `on:` block.
 */
export function hasScheduleTrigger(text) {
  let inOn = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) {
      inOn = /^(on|'on'|"on"):\s*$/.test(line.trim());
      continue;
    }
    if (inOn && /^\s+schedule:\s*$/.test(line)) return true;
  }
  return false;
}

/** Validates the registry shape; returns error strings. */
export function validateRegistryShape(registry) {
  const errors = [];
  if (!registry || !Array.isArray(registry.gates)) {
    return ['registry must have a gates array'];
  }
  const seen = new Set();
  const entries = [...registry.gates, ...(registry.exempt ?? [])];
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.workflow !== 'string' ||
      !/^[A-Za-z0-9_.-]+\.ya?ml$/.test(entry.workflow)
    ) {
      errors.push(`invalid workflow entry: ${JSON.stringify(entry)}`);
      continue;
    }
    if (seen.has(entry.workflow)) errors.push(`duplicate registry entry: ${entry.workflow}`);
    seen.add(entry.workflow);
  }
  for (const gate of registry.gates) {
    if (!Number.isInteger(gate?.maxAgeHours) || gate.maxAgeHours < 1) {
      errors.push(`${gate?.workflow}: maxAgeHours must be a positive integer`);
    }
  }
  for (const ex of registry.exempt ?? []) {
    if (typeof ex?.reason !== 'string' || ex.reason.trim() === '') {
      errors.push(`${ex?.workflow}: exempt entries need a reason`);
    }
  }
  return errors;
}

/**
 * Pure check. `workflows` maps file name -> text.
 * @returns {string[]} errors
 */
export function checkRegistry(registry, workflows) {
  const errors = validateRegistryShape(registry);
  if (errors.length > 0) return errors;
  const listed = new Set([...registry.gates, ...(registry.exempt ?? [])].map((g) => g.workflow));
  for (const [file, text] of Object.entries(workflows)) {
    if (hasScheduleTrigger(text) && !listed.has(file)) {
      errors.push(`${WORKFLOWS_REL}/${file} has a schedule: trigger but is not in ${REGISTRY_REL}`);
    }
  }
  for (const name of listed) {
    if (!(name in workflows)) {
      errors.push(`${REGISTRY_REL} lists ${name}, which does not exist in ${WORKFLOWS_REL}`);
    } else if (!hasScheduleTrigger(workflows[name])) {
      errors.push(`${REGISTRY_REL} lists ${name}, which has no schedule: trigger`);
    }
  }
  return errors;
}

export function loadWorkflows(root) {
  const dir = join(root, WORKFLOWS_REL);
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    if (/\.ya?ml$/.test(name)) out[name] = readFileSync(join(dir, name), 'utf8');
  }
  return out;
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : DEFAULT_ROOT;
  const registryPath = join(root, REGISTRY_REL);
  if (!existsSync(registryPath)) {
    console.error(`check-scheduled-gates-registry: FAIL\n  missing ${REGISTRY_REL}`);
    return 1;
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (err) {
    console.error(
      `check-scheduled-gates-registry: FAIL\n  ${REGISTRY_REL} is not JSON: ${err.message}`,
    );
    return 1;
  }
  const errors = checkRegistry(registry, loadWorkflows(root));
  if (errors.length > 0) {
    console.error('check-scheduled-gates-registry: FAIL');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(
    `check-scheduled-gates-registry: PASS (${registry.gates.length} watched, ${(registry.exempt ?? []).length} exempt)`,
  );
  return 0;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  process.exit(main(process.argv.slice(2)));
}
