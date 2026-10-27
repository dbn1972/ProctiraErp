/**
 * PRC-L108 — scheduled-gate watchdog verdicts and issue reporting.
 * Run with: node --test tools/scripts/scheduled-gate-freshness.test.mjs
 * No network: fetch is injected.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUE_LABEL, evaluateGate, issueTitle, run } from './scheduled-gate-freshness.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const NIGHTLY = { workflow: 'supply-chain.yml', maxAgeHours: 48 };
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();
const runAt = (h, conclusion, status = 'completed') => ({
  status,
  conclusion,
  created_at: hoursAgo(h),
  html_url: `https://github.com/o/r/actions/runs/${h}`,
});

test('fresh successful latest run passes', () => {
  const v = evaluateGate(NIGHTLY, [runAt(30, 'success'), runAt(6, 'success')], NOW);
  assert.equal(v.ok, true, v.reasons.join('; '));
});

test('latest scheduled run failed is flagged even with a recent success', () => {
  const v = evaluateGate(NIGHTLY, [runAt(30, 'success'), runAt(6, 'failure')], NOW);
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /concluded failure/);
});

for (const conclusion of ['cancelled', 'timed_out']) {
  test(`latest scheduled run ${conclusion} is flagged`, () => {
    const v = evaluateGate(NIGHTLY, [runAt(6, conclusion), runAt(30, 'success')], NOW);
    assert.equal(v.ok, false);
    assert.match(v.reasons.join(' '), new RegExp(`concluded ${conclusion}`));
  });
}

test('stale: last success older than maxAgeHours is flagged', () => {
  const v = evaluateGate(NIGHTLY, [runAt(72, 'success')], NOW);
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(' '), /older than 48h/);
});

test('never ran / no success is flagged', () => {
  assert.equal(evaluateGate(NIGHTLY, [], NOW).ok, false);
  const v = evaluateGate(NIGHTLY, [runAt(5, 'skipped')], NOW);
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(' '), /no successful scheduled run/);
});

test('an in-progress newer run does not hide the latest completed verdict', () => {
  const v = evaluateGate(NIGHTLY, [runAt(1, null, 'in_progress'), runAt(20, 'success')], NOW);
  assert.equal(v.ok, true);
  const bad = evaluateGate(NIGHTLY, [runAt(1, null, 'in_progress'), runAt(20, 'failure')], NOW);
  assert.equal(bad.ok, false);
});

function fakeGitHub({ runsByWorkflow, label = true, openIssues = [] }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const method = init.method;
    calls.push({
      method,
      path: u.pathname + u.search,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    const wf = /\/actions\/workflows\/([^/]+)\/runs$/.exec(u.pathname);
    if (method === 'GET' && wf) {
      assert.equal(u.searchParams.get('event'), 'schedule');
      return json(200, { workflow_runs: runsByWorkflow[decodeURIComponent(wf[1])] ?? [] });
    }
    if (method === 'GET' && u.pathname.endsWith(`/labels/${ISSUE_LABEL}`)) {
      return label ? json(200, { name: ISSUE_LABEL }) : json(404, {});
    }
    if (method === 'GET' && u.pathname.endsWith('/issues')) return json(200, openIssues);
    if (method === 'POST') return json(201, {});
    return json(500, {});
  };
  return { calls, fetchImpl };
}

const registry = {
  gates: [NIGHTLY, { workflow: 'restore-drill.yml', maxAgeHours: 192 }],
};

test('run: flagged gate creates the label and one issue; healthy gate writes nothing', async () => {
  const gh = fakeGitHub({
    runsByWorkflow: {
      'supply-chain.yml': [runAt(6, 'failure')],
      'restore-drill.yml': [runAt(30, 'success')],
    },
    label: false,
  });
  const { flagged } = await run({
    registry,
    repo: 'o/r',
    token: 't',
    now: NOW,
    dryRun: false,
    runUrl: 'https://github.com/o/r/actions/runs/1',
    fetchImpl: gh.fetchImpl,
    log: () => {},
  });
  assert.deepEqual(
    flagged.map((f) => f.workflow),
    ['supply-chain.yml'],
  );
  const posts = gh.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2);
  assert.ok(posts[0].path.endsWith('/labels'));
  assert.ok(posts[1].path.endsWith('/issues'));
  assert.equal(posts[1].body.title, issueTitle('supply-chain.yml'));
  assert.deepEqual(posts[1].body.labels, [ISSUE_LABEL]);
});

test('run: an existing open issue gets a comment instead of a duplicate', async () => {
  const gh = fakeGitHub({
    runsByWorkflow: {
      'supply-chain.yml': [runAt(80, 'success')],
      'restore-drill.yml': [runAt(30, 'success')],
    },
    openIssues: [{ number: 7, title: issueTitle('supply-chain.yml') }],
  });
  await run({
    registry,
    repo: 'o/r',
    token: 't',
    now: NOW,
    dryRun: false,
    fetchImpl: gh.fetchImpl,
    log: () => {},
  });
  const posts = gh.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].path.endsWith('/issues/7/comments'));
});

test('run --dry-run performs no writes', async () => {
  const gh = fakeGitHub({ runsByWorkflow: {} });
  const { flagged } = await run({
    registry,
    repo: 'o/r',
    token: 't',
    now: NOW,
    dryRun: true,
    fetchImpl: gh.fetchImpl,
    log: () => {},
  });
  assert.equal(flagged.length, 2);
  assert.equal(gh.calls.filter((c) => c.method !== 'GET').length, 0);
});
