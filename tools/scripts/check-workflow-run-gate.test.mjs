#!/usr/bin/env node
/**
 * PRC-H061 — Deploy/Release workflow_run gate contract.
 * Run with: node --test tools/scripts/check-workflow-run-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { evaluateGuard, workflowRunGateContract } from './check-workflow-run-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = ['.github/workflows/deploy.yml', '.github/workflows/release.yml'];
const REPO = 'proctira/ProctiraErp';

const payload = (workflowRun, eventName = 'workflow_run') => ({
  github: {
    event_name: eventName,
    repository: REPO,
    event: { workflow_run: workflowRun },
  },
});

const trustedPush = {
  conclusion: 'success',
  event: 'push',
  head_branch: 'main',
  head_repository: { full_name: REPO },
};

for (const file of WORKFLOWS) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const gateIf = parse(text).jobs['ci-gate'].if;

  test(`${file}: satisfies the workflow_run gate contract`, () => {
    assert.deepEqual(workflowRunGateContract(text, file), []);
  });

  test(`${file}: trusted push to main still runs the gate`, () => {
    assert.equal(evaluateGuard(gateIf, payload(trustedPush)), true);
  });

  test(`${file}: fork PR from a branch named main is skipped`, () => {
    const forkPr = {
      ...trustedPush,
      event: 'pull_request',
      head_repository: { full_name: 'attacker/ProctiraErp' },
    };
    assert.equal(evaluateGuard(gateIf, payload(forkPr)), false);
  });

  test(`${file}: same-repo pull_request CI run is skipped`, () => {
    assert.equal(evaluateGuard(gateIf, payload({ ...trustedPush, event: 'pull_request' })), false);
  });

  test(`${file}: push from a different head repository is skipped`, () => {
    const foreign = { ...trustedPush, head_repository: { full_name: 'attacker/ProctiraErp' } };
    assert.equal(evaluateGuard(gateIf, payload(foreign)), false);
  });

  test(`${file}: failed CI push run is skipped`, () => {
    assert.equal(evaluateGuard(gateIf, payload({ ...trustedPush, conclusion: 'failure' })), false);
  });

  test(`${file}: workflow_dispatch still reaches the same-SHA CI check`, () => {
    assert.equal(evaluateGuard(gateIf, payload(undefined, 'workflow_dispatch')), true);
  });
}

test('contract flags a branch-name-only gate', () => {
  const weak = `
on:
  workflow_run:
    workflows: ['CI']
    types: [completed]
    branches: [main]
jobs:
  ci-gate:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  build:
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
`;
  const problems = workflowRunGateContract(weak, 'weak.yml');
  assert.ok(problems.some((p) => p.includes("workflow_run.event == 'push'")));
  assert.ok(problems.some((p) => p.includes('head_repository.full_name == github.repository')));
  assert.ok(problems.some((p) => p.includes('`build` does not depend on ci-gate')));
});
