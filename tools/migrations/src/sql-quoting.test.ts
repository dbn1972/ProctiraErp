import { describe, expect, it } from 'vitest';
import { assertSafeTypeName, quoteIdent, quoteLiteral } from './sql-safety.js';
import { loadConfig } from './config.js';
import { buildTransformExpression, buildTransformSQL } from './transform-schema.js';

// PRC-L376 (PRO-S55-14): identifiers/literals in generated SQL are quoted, not spliced.
describe('SQL quoting (PRC-L376)', () => {
  it('quotes identifiers and literals like pg-format %I / %L', () => {
    expect(quoteIdent('students')).toBe('"students"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(() => quoteIdent('')).toThrow();
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
    expect(quoteLiteral('a\\b')).toBe("E'a\\\\b'");
  });

  it('a hostile column name cannot break out of the identifier', () => {
    const expr = buildTransformExpression('x"; DROP TABLE t; --', undefined);
    expect(expr).toBe('s."x""; DROP TABLE t; --"');
    const sql = buildTransformSQL(
      {
        sourceTable: 'src',
        targetTable: 'dst',
        legacyPkColumn: 'id',
        columns: [{ source: 'a', target: 'b"c', transform: { type: 'default', value: "x'y" } }],
        foreignKeys: [],
      } as never,
      'stage',
      'public',
    );
    expect(sql).toContain('"b""c"');
    expect(sql).toContain("'x''y'");
  });

  it('rejects unsafe CAST type names', () => {
    expect(assertSafeTypeName('varchar(20)')).toBe('varchar(20)');
    expect(() => assertSafeTypeName('int); DROP TABLE t; --')).toThrow();
  });

  it('legacy MySQL TLS defaults on in production and needs an override to disable', () => {
    const base = {
      LEGACY_MYSQL_USER: 'u',
      LEGACY_MYSQL_PASSWORD: 'p',
      TARGET_PG_USER: 'u',
      TARGET_PG_PASSWORD: 'p',
      PGSSLMODE: 'verify-full',
    };
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).mysql.ssl).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).mysql.ssl).toBe(false);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', LEGACY_MYSQL_SSL: 'false' }),
    ).toThrow(/MIGRATION_ALLOW_INSECURE_MYSQL/);
  });
});
