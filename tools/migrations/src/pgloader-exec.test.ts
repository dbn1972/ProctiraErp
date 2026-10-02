import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { execPgloader, parsePgloaderSummary } from './pgloader-exec.js';

const dir = mkdtempSync(join(tmpdir(), 'pgloader-exec-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const OK_SUMMARY = `
             table name     errors       rows      bytes      total time
-----------------------  ---------  ---------  ---------  --------------
        fetch meta data          0         33                     0.365s
-----------------------  ---------  ---------  ---------  --------------
 "staging"."security_users"          0       1200    112.0 kB          0.210s
 "staging"."institutions"          0         40      4.1 kB          0.050s
-----------------------  ---------  ---------  ---------  --------------
      Total import time          ✓       1240    116.1 kB          0.900s
`;

const ERROR_SUMMARY = `
                    table name     errors       read   imported      bytes      total time
------------------------------  ---------  ---------  ---------  ---------  --------------
 "staging"."security_users"          3       1200       1197    112.0 kB          0.210s
 "staging"."institutions"            0         40         40      4.1 kB          0.050s
------------------------------  ---------  ---------  ---------  ---------  --------------
             Total import time          3       1240       1237    116.1 kB          0.900s
`;

describe('execPgloader (PRC-L377)', () => {
  it("PGLOADER_BIN='pgloader; touch /tmp/x' does not run a shell", () => {
    const marker = join(dir, 'x');
    expect(() => execPgloader(`pgloader; touch ${marker}`, join(dir, 'cfg.load'), 5_000)).toThrow();
    expect(existsSync(marker)).toBe(false);
  });

  it('passes the config path as a single argv entry', () => {
    const out = execPgloader('/bin/echo', 'a path; touch nothing', 5_000);
    expect(out.trim()).toBe('a path; touch nothing');
  });
});

describe('parsePgloaderSummary (PRC-L377)', () => {
  it('reports zero errors and the imported total for a clean run', () => {
    const s = parsePgloaderSummary(OK_SUMMARY);
    expect(s.parsed).toBe(true);
    expect(s.errorCount).toBe(0);
    expect(s.rowsImported).toBe(1240);
  });

  it('surfaces non-zero errors per table (read/imported layout)', () => {
    const s = parsePgloaderSummary(ERROR_SUMMARY);
    expect(s.errorCount).toBe(3);
    expect(s.failedEntries).toEqual([{ name: '"staging"."security_users"', errors: 3 }]);
    expect(s.rowsImported).toBe(1237);
  });

  it('flags output without a summary as unparsed', () => {
    expect(parsePgloaderSummary('nothing useful').parsed).toBe(false);
  });
});

describe('runPgloader status (PRC-L377)', () => {
  it('returns status error when the summary has non-zero errors', async () => {
    vi.resetModules();
    vi.doMock('./pgloader-exec.js', async (orig) => ({
      ...(await orig<typeof import('./pgloader-exec.js')>()),
      execPgloader: () => ERROR_SUMMARY,
    }));
    vi.doMock('node:fs', async (orig) => ({
      ...(await orig<typeof import('node:fs')>()),
      readFileSync: () => 'LOAD DATABASE FROM {{MYSQL_HOST}}',
      writeFileSync: () => undefined,
    }));
    const { runPgloader } = await import('./pgloader-config.js');
    const result = runPgloader({
      mysql: { host: 'h', port: 1, database: 'd', user: 'u', password: 'p' },
      pg: { host: 'h', port: 1, database: 'd', user: 'u', password: 'p', schema: 'public' },
      batchSize: 1,
      defaultTenantName: 't',
      defaultTenantSlug: 't',
      stagingSchema: 'migration_staging',
      logLevel: 'info',
      pgloaderBin: 'pgloader',
    });
    expect(result.status).toBe('error');
    expect(result.errors[0]?.message).toMatch(/3 error/);
    vi.doUnmock('./pgloader-exec.js');
    vi.doUnmock('node:fs');
  });
});
