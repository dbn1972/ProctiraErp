#!/usr/bin/env node
/**
 * PRC-L181 — mutation tests for per-step scanner / cosign workflow contracts.
 * Run with: node --test tools/scripts/check-workflow-step-contracts.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cosignViolations,
  isSoftContinue,
  loadWorkflow,
  scannerViolations,
} from './check-workflow-step-contracts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const SCANS = read('.github/workflows/security-scans.yml');
const RELEASE = read('.github/workflows/release.yml');
const SUPPLY = read('.github/workflows/supply-chain.yml');
const clone = (o) => JSON.parse(JSON.stringify(o));

function scannerStep(wf, job, pred) {
  const step = wf.jobs[job].steps.find(pred);
  assert.ok(step, `fixture: ${job} step not found`);
  return step;
}

test('isSoftContinue treats true / expressions as soft', () => {
  assert.equal(isSoftContinue(undefined), false);
  assert.equal(isSoftContinue(false), false);
  assert.equal(isSoftContinue('false'), false);
  assert.equal(isSoftContinue(true), true);
  assert.equal(isSoftContinue('${{ github.event_name == "pull_request" }}'), true);
});

test('on-disk security-scans.yml satisfies the per-step contract', () => {
  assert.deepEqual(scannerViolations(loadWorkflow(SCANS)), []);
});

test('mutating one scanner step to soft-pass fails the contract', () => {
  const base = loadWorkflow(SCANS);
  const mutations = [
    (wf) => {
      scannerStep(wf, 'iac-trivy', (s) => /trivy-action/.test(s.uses ?? '')).with['exit-code'] =
        '0';
    },
    (wf) => {
      scannerStep(wf, 'container-fs-trivy', (s) => /trivy-action/.test(s.uses ?? ''))[
        'continue-on-error'
      ] = '${{ always() }}';
    },
    (wf) => {
      const s = scannerStep(wf, 'sast-semgrep', (x) => /semgrep scan/.test(x.run ?? ''));
      s.run = s.run.replace('--error', '');
    },
    (wf) => {
      const s = scannerStep(wf, 'secret-scan', (x) => /gitleaks detect/.test(x.run ?? ''));
      // soften only the last real invocation (a comment also mentions the flag)
      s.run = s.run.replace(/--exit-code 1(?![\s\S]*--exit-code 1)/, '--exit-code 0');
    },
    (wf) => {
      const s = scannerStep(wf, 'secret-scan', (x) => /gitleaks detect/.test(x.run ?? ''));
      s.run = `${s.run}\n || true`;
    },
    (wf) => {
      wf.jobs['sast-semgrep']['continue-on-error'] = true;
    },
    (wf) => {
      scannerStep(wf, 'iac-trivy', (s) => /trivy-action/.test(s.uses ?? '')).if =
        "github.event_name == 'push'";
    },
    (wf) => {
      delete wf.jobs['container-fs-trivy'];
    },
  ];
  mutations.forEach((mutate, i) => {
    const wf = clone(base);
    mutate(wf);
    assert.ok(scannerViolations(wf).length > 0, `mutation #${i} was not detected`);
  });
});

test('on-disk release.yml and supply-chain.yml run blocking cosign sign + verify', () => {
  assert.deepEqual(cosignViolations(loadWorkflow(RELEASE)), []);
  assert.deepEqual(cosignViolations(loadWorkflow(SUPPLY)), []);
});

test('removing cosign steps fails the provenance check', () => {
  for (const text of [RELEASE, SUPPLY]) {
    const base = loadWorkflow(text);
    const noSign = clone(base);
    const noVerify = clone(base);
    const soft = clone(base);
    for (const job of Object.values(noSign.jobs)) {
      job.steps = (job.steps ?? []).filter((s) => !/\bcosign\s+sign\b/.test(s.run ?? ''));
    }
    for (const job of Object.values(noVerify.jobs)) {
      job.steps = (job.steps ?? []).filter((s) => !/\bcosign\s+verify\b/.test(s.run ?? ''));
    }
    for (const job of Object.values(soft.jobs)) {
      for (const s of job.steps ?? []) {
        if (/\bcosign\s+sign\b/.test(s.run ?? '')) s['continue-on-error'] = true;
      }
    }
    assert.match(cosignViolations(noSign).join('\n'), /cosign sign/);
    assert.match(cosignViolations(noVerify).join('\n'), /cosign verify/);
    assert.match(cosignViolations(soft).join('\n'), /continue-on-error/);
  }
});

test('invalid YAML fails closed', () => {
  assert.throws(() => loadWorkflow('jobs: [unclosed'), /invalid YAML/);
  assert.throws(() => loadWorkflow('name: x\n'), /no jobs/);
});
