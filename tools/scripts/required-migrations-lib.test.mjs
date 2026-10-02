// PRC-L188 / PRC-L381: deploy gates derive their required migration sets from
// db/sql and schema-readiness.ts. psql/pnpm are replaced by PATH stubs that
// emulate schema_migrations, so no database is touched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const lib = join(root, 'tools/scripts/required-migrations-lib.sh');
const readinessTs = join(root, 'packages/shared/database/src/schema-readiness.ts');
const tmp = mkdtempSync(join(tmpdir(), 'req-migrations-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function runLib(fn, arg) {
  return spawnSync('bash', ['-c', `source "$1"; ${fn} "$2"`, 'x', lib, arg], { encoding: 'utf8' });
}

function expectedSqlSet() {
  return readdirSync(join(root, 'db/sql'))
    .filter((f) => /^[0-9].*\.sql$/.test(f) && !/^[0-9]+b_.*_seed\.sql$/.test(f))
    .sort();
}

function expectedRuntimeSet() {
  const src = readFileSync(readinessTs, 'utf8');
  const body = src.split('PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS = [')[1].split('] as const')[0];
  const permanent = body
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .flatMap((l) => [...l.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const current = /CURRENT_RUNTIME_SCHEMA_MIGRATION = '([^']+)'/.exec(src)[1];
  return [...new Set([...permanent, current])];
}

test('required_sql_migrations lists every non-seed db/sql file (incl. 104 and latest)', () => {
  const r = runLib('required_sql_migrations', join(root, 'db/sql'));
  assert.equal(r.status, 0, r.stderr);
  const listed = r.stdout.trim().split('\n');
  assert.deepEqual(listed, expectedSqlSet());
  assert.ok(listed.includes('104_scholarship_application_documents.sql'));
  assert.ok(!listed.some((f) => /_seed\.sql$/.test(f)));
});

test('required_sql_migrations fails closed on a missing or empty directory', () => {
  assert.notEqual(runLib('required_sql_migrations', join(tmp, 'nope')).status, 0);
  assert.notEqual(runLib('required_sql_migrations', tmp).status, 0);
});

test('shell runtime list equals the TS REQUIRED_RUNTIME_MIGRATIONS list', () => {
  const r = runLib('required_runtime_migrations', readinessTs);
  assert.equal(r.status, 0, r.stderr);
  const listed = r.stdout.trim().split('\n');
  assert.deepEqual(listed, expectedRuntimeSet());
  assert.ok(listed.includes('100_tenant_id_uuid_fks.sql'));
});

test('required_runtime_migrations fails closed when the TS contract is unparsable', () => {
  const broken = join(tmp, 'schema-readiness.ts');
  writeFileSync(broken, "export const CURRENT_RUNTIME_SCHEMA_MIGRATION = '106_x.sql';\n");
  assert.notEqual(runLib('required_runtime_migrations', broken).status, 0);
  assert.notEqual(runLib('required_runtime_migrations', join(tmp, 'missing.ts')).status, 0);
});

/**
 * PATH stub for psql: answers the migrator role probe, records the required
 * list it receives and emulates the verification against FAKE_APPLIED.
 */
function makeStubs() {
  const bin = mkdtempSync(join(tmp, 'bin-'));
  writeFileSync(
    join(bin, 'psql'),
    `#!/usr/bin/env bash
req=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -v) shift; case "$1" in required_migrations=*) req="\${1#required_migrations=}" ;; esac ;;
    -c) shift; [[ "$1" == *rolsuper* ]] && { printf 'proctira\\tfalse\\tfalse\\n'; exit 0; } ;;
  esac
  shift
done
[[ -n "$req" ]] || { echo "stub psql: no required list" >&2; exit 9; }
applied=",\${FAKE_APPLIED},"
missing=(); total=0
IFS=, read -ra names <<<"$req"
for n in "\${names[@]}"; do total=$((total+1)); [[ "$applied" == *",$n,"* ]] || missing+=("$n"); done
if [[ "\${STUB_MODE:-}" == runtime ]]; then
  m="$(IFS=,; echo "\${missing[*]}")"
  printf 'proctira_app\\t%s\\t%s\\t%s\\t%s\\n' "\${#missing[@]}" "$total" "$req" "$m"
  exit 0
fi
cat >/dev/null
if (( \${#missing[@]} > 0 )); then
  echo "ERROR:  target migration contract incomplete: \${missing[*]}" >&2
  exit 3
fi
`,
  );
  writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(bin, 'psql'), 0o755);
  chmodSync(join(bin, 'pnpm'), 0o755);
  return bin;
}

function runScript(script, env) {
  const bin = makeStubs();
  return spawnSync('bash', [join(root, 'tools/scripts', script)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
  });
}

test('runtime gate fails when 100 is missing from the database', () => {
  const all = expectedRuntimeSet();
  const ok = runScript('assert-runtime-schema-ready.sh', {
    STUB_MODE: 'runtime',
    DATABASE_URL: 'postgresql://stub/db',
    FAKE_APPLIED: all.join(','),
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`all ${all.length} required migrations`));

  const without100 = all.filter((f) => f !== '100_tenant_id_uuid_fks.sql');
  const bad = runScript('assert-runtime-schema-ready.sh', {
    STUB_MODE: 'runtime',
    DATABASE_URL: 'postgresql://stub/db',
    FAKE_APPLIED: without100.join(','),
  });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /missing: 100_tenant_id_uuid_fks\.sql/);
});

test('target migration stage fails when 104 is missing from schema_migrations', () => {
  // Sandbox root: the real stage + lib, a no-op apply-sql.sh and db/sql names.
  const sandbox = mkdtempSync(join(tmp, 'root-'));
  mkdirSync(join(sandbox, 'tools/scripts'), { recursive: true });
  mkdirSync(join(sandbox, 'db/sql'), { recursive: true });
  for (const f of ['run-target-database-migrations.sh', 'required-migrations-lib.sh']) {
    copyFileSync(join(root, 'tools/scripts', f), join(sandbox, 'tools/scripts', f));
  }
  writeFileSync(join(sandbox, 'tools/scripts/apply-sql.sh'), 'exit 0\n');
  for (const f of readdirSync(join(root, 'db/sql'))) writeFileSync(join(sandbox, 'db/sql', f), '');
  const bin = makeStubs();
  const run = (applied) =>
    spawnSync('bash', [join(sandbox, 'tools/scripts/run-target-database-migrations.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        MIGRATOR_DATABASE_URL: 'postgresql://stub/db',
        FAKE_APPLIED: applied.join(','),
      },
    });
  const all = expectedSqlSet();
  const ok = run(all);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`${all.length} db/sql migrations verified`));
  const bad = run(all.filter((f) => f !== '104_scholarship_application_documents.sql'));
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /incomplete: 104_scholarship_application_documents\.sql/);
});
