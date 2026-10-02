/**
 * PRC-L505 — guard-sensitive-operations.mjs must ask before destructive data
 * commands (compose down -v, dropdb, psql DROP, find -delete, wrapped rm) and
 * before deleting/rewriting db/sql migrations or infra manifests.
 *
 * Feeds synthetic PreToolUse events on stdin; nothing is executed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hook = resolve(here, 'guard-sensitive-operations.mjs');

const sandbox = mkdtempSync(join(tmpdir(), 'l505-'));
mkdirSync(join(sandbox, 'db/sql'), { recursive: true });
mkdirSync(join(sandbox, 'infrastructure/helm/x'), { recursive: true });
writeFileSync(join(sandbox, 'db/sql/001_core_onboarding_schema.sql'), '-- applied\n');
writeFileSync(join(sandbox, 'infrastructure/helm/x/values.yaml'), 'a: 1\n');
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));

function decide(event) {
  const res = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ cwd: sandbox, ...event }),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  if (!res.stdout.trim()) return 'allow';
  return JSON.parse(res.stdout).hookSpecificOutput.permissionDecision;
}

const bash = (command) => decide({ tool_name: 'execute_bash', tool_input: { command } });

for (const command of [
  'docker compose down -v',
  'docker compose -f docker-compose.yml down --volumes',
  'docker-compose down -v',
  'timeout 30 docker compose down -v',
  'docker volume rm proctira_pgdata',
  'docker system prune -af --volumes',
  'dropdb proctira',
  `psql "$DATABASE_URL" -c 'DROP TABLE students'`,
  'psql -c "truncate audit_events"',
  'pg_restore --clean -d proctira dump.sql',
  'find . -name "*.sql" -delete',
  'find db -type f -exec rm {} +',
  'git ls-files db/sql | xargs rm -rf',
  'timeout -s KILL 10 rm -rf node_modules',
  'nice -n 10 rm -rf dist',
]) {
  test(`asks for: ${command}`, () => assert.equal(bash(command), 'ask'));
}

for (const command of [
  'docker compose down',
  'docker compose up -d',
  'psql "$DATABASE_URL" -c "SELECT 1"',
  'find . -name "*.sql"',
  'timeout 30 pnpm test',
  'ls | xargs echo',
]) {
  test(`allows: ${command}`, () => assert.equal(bash(command), 'allow'));
}

test('delete of db/sql/001_*.sql asks', () => {
  assert.equal(
    decide({
      tool_name: 'delete_file',
      tool_input: { targetFile: 'db/sql/001_core_onboarding_schema.sql' },
    }),
    'ask',
  );
});

test('editing an existing db/sql migration asks; creating a new one is allowed', () => {
  for (const tool of ['fs_write', 'str_replace', 'fs_append']) {
    assert.equal(
      decide({ tool_name: tool, tool_input: { path: 'db/sql/001_core_onboarding_schema.sql' } }),
      'ask',
      tool,
    );
  }
  assert.equal(
    decide({ tool_name: 'fs_write', tool_input: { path: 'db/sql/999_new_forward.sql' } }),
    'allow',
  );
});

test('infra manifests: delete and full overwrite ask; targeted edits and new files allowed', () => {
  const path = 'infrastructure/helm/x/values.yaml';
  assert.equal(decide({ tool_name: 'delete_file', tool_input: { targetFile: path } }), 'ask');
  assert.equal(decide({ tool_name: 'fs_write', tool_input: { path } }), 'ask');
  assert.equal(decide({ tool_name: 'str_replace', tool_input: { path } }), 'allow');
  assert.equal(
    decide({ tool_name: 'fs_write', tool_input: { path: 'infra/k8s/new.yaml' } }),
    'allow',
  );
  assert.equal(
    decide({ tool_name: 'delete_file', tool_input: { targetFile: 'infra/terraform/main.tf' } }),
    'ask',
  );
});

test('prisma/migrations deletion still asks (regression)', () => {
  assert.equal(
    decide({
      tool_name: 'delete_file',
      tool_input: { targetFile: 'packages/database/prisma/migrations/0001/migration.sql' },
    }),
    'ask',
  );
});
