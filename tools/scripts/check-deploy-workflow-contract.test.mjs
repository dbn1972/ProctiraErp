#!/usr/bin/env node
/**
 * PRC-L182 — mutation tests for the deploy.yml W1-OPS-15 job-graph contract
 * and the helm/rollback gate honesty fixes.
 * Run with: node --test tools/scripts/check-deploy-workflow-contract.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deployContractViolations, PROD_MARKER } from './check-deploy-workflow-contract.mjs';
import { loadWorkflow } from './check-workflow-step-contracts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const base = loadWorkflow(read('.github/workflows/deploy.yml'));
const clone = (o) => JSON.parse(JSON.stringify(o));

const gateStep = (wf) =>
  wf.jobs['deploy-secrets-gate'].steps.find((s) => /exit 1/.test(s.run ?? ''));
const prodStep = (wf) => wf.jobs.prepare.steps.find((s) => (s.run ?? '').includes(PROD_MARKER));

test('on-disk deploy.yml satisfies the W1-OPS-15 contract', () => {
  assert.deepEqual(deployContractViolations(base), []);
});

test('deleting or commenting out exit 1 in deploy-secrets-gate fails the check', () => {
  for (const replacement of ['', '# exit 1', 'exit 0']) {
    const wf = clone(base);
    const s = gateStep(wf);
    s.run = s.run.replace(/exit 1\s*$/, replacement);
    assert.match(deployContractViolations(wf).join('\n'), /ends in exit 1/, replacement);
  }
});

test('moving the exit to another job or softening the gate fails the check', () => {
  const mutations = [
    (wf) => {
      wf.jobs['other-job'] = { steps: [gateStep(wf)] };
      wf.jobs['deploy-secrets-gate'].steps = [];
    },
    (wf) => {
      wf.jobs['deploy-secrets-gate'].if = "needs.prepare.result == 'success'";
    },
    (wf) => {
      wf.jobs['deploy-secrets-gate'].needs = [];
    },
    (wf) => {
      gateStep(wf).if = 'false';
    },
    (wf) => {
      gateStep(wf)['continue-on-error'] = true;
    },
    (wf) => {
      delete wf.jobs['deploy-secrets-gate'];
    },
  ];
  mutations.forEach((mutate, i) => {
    const wf = clone(base);
    mutate(wf);
    assert.ok(deployContractViolations(wf).length > 0, `mutation #${i} was not detected`);
  });
});

test('production registry error must be followed by exit 1', () => {
  const wf = clone(base);
  const s = prodStep(wf);
  s.run = s.run.replace(/(W1-OPS-15: Production deploy[^\n]*\n\s*)exit 1/, '$1# exit 1');
  assert.match(deployContractViolations(wf).join('\n'), /followed by exit 1/);
});

test('helm-template-check lints the platform chart fail-closed', () => {
  const src = read('tools/scripts/helm-template-check.sh');
  assert.match(src, /^helm lint "\$\{PLATFORM_CHART\}"\s*$/m);
  assert.doesNotMatch(src, /helm lint[^\n]*\|\|\s*true/);
});

test('deploy-rollback-check does not claim an unexecuted helm dry-run', () => {
  const src = read('tools/scripts/deploy-rollback-check.sh');
  assert.doesNotMatch(src, /\[dry-run\] helm rollback/);
  assert.match(src, /check-deploy-workflow-contract\.mjs|NOT executed/);
});
