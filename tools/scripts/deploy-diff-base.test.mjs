import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TASK,
  environmentForScope,
  getBase,
  recordBase,
  scopeForBranch,
} from './deploy-diff-base.mjs';

const SHA = 'a'.repeat(40);
const ENV = { GH_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: 'https://api.test' };
const quiet = { error() {} };

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status < 300, status: next.status, json: async () => next.body };
  };
  return { impl, calls };
}

test('scopes map to bookkeeping environments only', () => {
  assert.equal(environmentForScope('production'), 'diff-base-production');
  assert.equal(scopeForBranch('release', 'release/1.2'), 'release-release-1.2');
  assert.throws(() => environmentForScope('Prod\nX'), /invalid scope/);
  assert.throws(() => environmentForScope(''), /invalid scope/);
  assert.throws(() => scopeForBranch('release', ''), /branch is required/);
});

test('get queries the scope environment + task and returns the recorded sha', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: [{ sha: SHA }] }]);
  assert.equal(await getBase({ scope: 'production', env: ENV, fetchImpl: impl, log: quiet }), SHA);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/repos/o/r/deployments');
  assert.equal(url.searchParams.get('environment'), 'diff-base-production');
  assert.equal(url.searchParams.get('task'), TASK);
});

test('get fails safe to empty (full fan-out) on no record, bad sha, HTTP or network error', async () => {
  for (const response of [
    { status: 200, body: [] },
    { status: 200, body: [{ sha: 'main' }] },
    { status: 403, body: {} },
    new Error('ECONNRESET'),
  ]) {
    const { impl } = fakeFetch([response]);
    assert.equal(await getBase({ scope: 'staging', env: ENV, fetchImpl: impl, log: quiet }), '');
  }
  assert.equal(await getBase({ scope: 'staging', env: {}, fetchImpl: fetch, log: quiet }), '');
});

test('record creates a deployment for the exact sha and marks it successful', async () => {
  const { impl, calls } = fakeFetch([
    { status: 201, body: { id: 7 } },
    { status: 201, body: {} },
  ]);
  await recordBase({ scope: 'production', sha: SHA, env: ENV, fetchImpl: impl });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ref, SHA);
  assert.equal(body.environment, 'diff-base-production');
  assert.equal(body.task, TASK);
  assert.deepEqual(body.required_contexts, []);
  assert.equal(new URL(calls[1].url).pathname, '/repos/o/r/deployments/7/statuses');
  assert.equal(JSON.parse(calls[1].init.body).state, 'success');
});

test('record rejects non-sha input and API failures', async () => {
  await assert.rejects(recordBase({ scope: 'production', sha: 'HEAD', env: ENV }), /40 lowercase/);
  const { impl } = fakeFetch([{ status: 422, body: {} }]);
  await assert.rejects(
    recordBase({ scope: 'production', sha: SHA, env: ENV, fetchImpl: impl }),
    /HTTP 422/,
  );
});
