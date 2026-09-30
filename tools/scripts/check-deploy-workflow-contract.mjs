#!/usr/bin/env node
/**
 * PRC-L182 — YAML-backed W1-OPS-15 contract for .github/workflows/deploy.yml
 * (replaces `grep -A40 … | grep -q 'exit 1'` windows).
 *
 * Asserts the job graph and step bodies:
 *   - prepare job: the step printing the production W1-OPS-15 error exits 1
 *     on the very next executable line
 *   - deploy-secrets-gate job: needs prepare, `if:` uses always(), and a
 *     non-conditional step reads can-deploy and ends in an executable `exit 1`
 *
 * Usage: node tools/scripts/check-deploy-workflow-contract.mjs [deploy.yml]
 * Exits 1 on any violation, invalid YAML, or missing file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSoftContinue, loadWorkflow } from './check-workflow-step-contracts.mjs';

export const PROD_MARKER =
  'W1-OPS-15: Production deploy requires REGISTRY_USERNAME and REGISTRY_PASSWORD';

/** Executable (non-blank, non-comment) shell lines of a step. */
export function execLines(run) {
  return String(run ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/**
 * @param {Record<string, any>} wf parsed deploy workflow
 * @returns {string[]}
 */
export function deployContractViolations(wf) {
  const out = [];
  const prepare = wf.jobs.prepare;
  if (!prepare) {
    out.push('missing prepare job');
  } else {
    const steps = (prepare.steps ?? []).filter(
      (s) => s && String(s.run ?? '').includes(PROD_MARKER),
    );
    if (steps.length === 0) out.push('prepare: no step emits the production W1-OPS-15 error');
    for (const step of steps) {
      if (isSoftContinue(step['continue-on-error'])) {
        out.push(`prepare step "${step.name}": continue-on-error must be false/absent`);
      }
      const lines = execLines(step.run);
      const at = lines.findIndex((l) => l.includes(PROD_MARKER));
      if (lines[at + 1] !== 'exit 1') {
        out.push(
          `prepare step "${step.name}": production secrets error must be followed by exit 1`,
        );
      }
      if (
        String(step.env?.ENVIRONMENT ?? '').replace(/\s/g, '') !==
        '${{steps.env.outputs.environment}}'
      ) {
        out.push(`prepare step "${step.name}": must bind ENVIRONMENT from steps.env`);
      }
    }
  }

  const gate = wf.jobs['deploy-secrets-gate'];
  if (!gate) {
    out.push('missing deploy-secrets-gate job');
    return out;
  }
  if (!asArray(gate.needs).includes('prepare')) out.push('deploy-secrets-gate must need prepare');
  if (!/\balways\(\)/.test(String(gate.if ?? ''))) {
    out.push('deploy-secrets-gate if: must use always() so a skipped deploy still evaluates');
  }
  if (isSoftContinue(gate['continue-on-error'])) {
    out.push('deploy-secrets-gate: continue-on-error must be false/absent');
  }
  const failing = (gate.steps ?? []).filter(
    (s) =>
      s &&
      s.if === undefined &&
      !isSoftContinue(s['continue-on-error']) &&
      JSON.stringify(s.env ?? {}).includes('needs.prepare.outputs.can-deploy') &&
      execLines(s.run).at(-1) === 'exit 1',
  );
  if (failing.length === 0) {
    out.push('deploy-secrets-gate: needs a blocking step that reads can-deploy and ends in exit 1');
  }
  return out;
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  const file = process.argv[2] ?? '.github/workflows/deploy.yml';
  let failures;
  try {
    if (!existsSync(resolve(file))) throw new Error(`${file}: missing`);
    failures = deployContractViolations(loadWorkflow(readFileSync(resolve(file), 'utf8'), file));
  } catch (err) {
    console.error(
      `check-deploy-workflow-contract: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  if (failures.length > 0) {
    console.error('check-deploy-workflow-contract: FAIL');
    for (const f of failures) console.error(`  - ${file}: ${f}`);
    process.exit(1);
  }
  console.log('check-deploy-workflow-contract: PASS');
}
