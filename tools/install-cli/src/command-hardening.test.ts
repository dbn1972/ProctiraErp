/**
 * Tests for Volume 11 command hardening (PRC-M411..M416).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { run, SUBCOMMANDS } from './cli';
import { redactUrlSecrets } from './commands/diagnostics';
import { runReadinessCheck } from './commands/readiness';
import { runUpgradeCheck } from './commands/upgrade-check';

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

// ─── PRC-M411: subcommand dispatch ───────────────────────────────────────────

describe('PRC-M411 subcommand dispatch', () => {
  it('exposes the five operational subcommands', () => {
    expect(Object.keys(SUBCOMMANDS).sort()).toEqual(
      ['diagnostics', 'health', 'readiness', 'upgrade-check', 'validate'].sort(),
    );
  });

  it('dispatches a known subcommand instead of running the installer', async () => {
    const spy = vi.spyOn(SUBCOMMANDS, 'readiness').mockResolvedValue(undefined);
    const result = await run(['node', 'script', 'readiness', '--timeout', '1']);
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(['--timeout', '1']);
  });

  it('rejects an unknown positional command (fail closed)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await run(['node', 'script', 'bogus-command']);
    expect(result).toBeNull();
    expect(process.exitCode).toBe(1);
  });
});

// ─── PRC-M412: URL secret redaction ──────────────────────────────────────────

describe('PRC-M412 redactUrlSecrets', () => {
  it('strips userinfo from a database URL', () => {
    const out = redactUrlSecrets('postgres://user:supersecret@db.host:5432/app');
    expect(out).not.toContain('supersecret');
    expect(out).toContain('***:***@');
  });

  it('strips a redis URL password', () => {
    const out = redactUrlSecrets('redis://:p4ssw0rd@cache:6379');
    expect(out).not.toContain('p4ssw0rd');
  });

  it('strips secret query params', () => {
    const out = redactUrlSecrets('https://x/callback?token=abc123&ok=1');
    expect(out).not.toContain('abc123');
    expect(out).toContain('ok=1');
  });

  it('leaves non-secret URLs intact', () => {
    expect(redactUrlSecrets('http://localhost:3000/health')).toBe('http://localhost:3000/health');
  });
});

// ─── PRC-M414: readiness grading ─────────────────────────────────────────────

describe('PRC-M414 readiness scoring', () => {
  it('rejects a short/weak JWT_SECRET even when present', async () => {
    const prev = { ...process.env };
    process.env['JWT_SECRET'] = 'abc';
    process.env['COOKIE_SECRET'] = 'abc';
    try {
      const report = await runReadinessCheck({ gatewayUrl: 'http://127.0.0.1:1', timeoutMs: 1 });
      const secrets = report.categories.find((c) => c.name === 'secrets')!;
      expect(secrets.status).toBe('fail');
      // Grade must be capped below A/B when a critical control fails.
      expect(['C', 'D', 'F']).toContain(report.grade);
    } finally {
      process.env = prev;
    }
  });
});

// ─── PRC-M415: upgrade-check ─────────────────────────────────────────────────

describe('PRC-M415 upgrade pre-check', () => {
  it("never emits 'go' against an unpinned 'latest' target", async () => {
    const result = await runUpgradeCheck({ targetVersion: 'latest' });
    expect(result.decision).not.toBe('go');
    expect(result.blockers.join(' ')).toMatch(/not pinned|latest/i);
  });

  it('blocks when no recent backup timestamp is present', async () => {
    const prev = { ...process.env };
    delete process.env['LAST_BACKUP_TIMESTAMP'];
    process.env['DB_BACKUP_ENABLED'] = 'true';
    try {
      const result = await runUpgradeCheck({ targetVersion: '99.0.0' });
      expect(result.checks.backupExists).toBe(false);
      expect(result.blockers.join(' ')).toMatch(/backup/i);
    } finally {
      process.env = prev;
    }
  });
});
