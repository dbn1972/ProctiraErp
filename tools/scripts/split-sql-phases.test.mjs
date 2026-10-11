/**
 * PRC-L509 — split-sql-phases tokenizer must not mis-split on E'…' escape
 * strings, double-quoted identifiers containing ';', or BEGIN ATOMIC / block
 * comments, and must refuse transaction control fail-closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSqlPhases, SqlPhaseSplitError } from './split-sql-phases.mjs';

test('E-string with escaped quote and semicolon stays one phase', () => {
  const sql = "INSERT INTO t(x) VALUES (E'a\\';b');";
  const phases = splitSqlPhases(sql);
  assert.equal(phases.length, 1);
  assert.match(phases[0], /E'a\\';b'/);
});

test('E-string with escaped backslash before quote does not terminate early', () => {
  const sql = "SELECT E'c:\\\\'; SELECT 2;";
  const phases = splitSqlPhases(sql);
  assert.equal(phases.length, 2);
});

test('double-quoted identifier containing a semicolon stays one phase', () => {
  const sql = 'CREATE INDEX ON t ("a;b");';
  const phases = splitSqlPhases(sql);
  assert.equal(phases.length, 1);
  assert.match(phases[0], /"a;b"/);
});

test('double-quoted identifier with escaped quote is handled', () => {
  const sql = 'SELECT "a""b;c" FROM t; SELECT 2;';
  const phases = splitSqlPhases(sql);
  assert.equal(phases.length, 2);
});

test('ordinary CONCURRENTLY statements still split per statement', () => {
  const sql = 'CREATE INDEX CONCURRENTLY i1 ON t (a);\nCREATE INDEX CONCURRENTLY i2 ON t (b);\n';
  const phases = splitSqlPhases(sql);
  assert.equal(phases.length, 2);
});

test('dollar-quoted PL/pgSQL body with BEGIN...END is NOT treated as txn control', () => {
  const sql = 'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$;';
  const phases = splitSqlPhases(sql);
  assert.equal(phases.length, 1);
});

test('BEGIN ATOMIC routine body is refused fail-closed', () => {
  const sql = 'CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;';
  assert.throws(() => splitSqlPhases(sql), SqlPhaseSplitError);
});

test('explicit transaction control is refused fail-closed', () => {
  assert.throws(() => splitSqlPhases('BEGIN; CREATE INDEX i ON t(a); COMMIT;'), SqlPhaseSplitError);
  assert.throws(() => splitSqlPhases('START TRANSACTION; SELECT 1;'), SqlPhaseSplitError);
  assert.throws(() => splitSqlPhases('SAVEPOINT sp1;'), SqlPhaseSplitError);
});

test('comment mentioning COMMIT does not trigger a refusal', () => {
  const sql = '-- we must not COMMIT here\nCREATE INDEX CONCURRENTLY i ON t(a);\n';
  const phases = splitSqlPhases(sql);
  assert.equal(phases.length, 1);
});
