// @vitest-environment node
/**
 * PRC-L413 — dev capture tooling must not sign tokens with a literal default
 * secret, and the screenshot mock gateway must be loopback-only and read-only.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPTS_DIR = fileURLToPath(new URL('../../scripts/', import.meta.url));
const WEB_DIR = path.resolve(SCRIPTS_DIR, '..');
const DEFAULT_SECRET = ['dev', 'secret', 'change', 'in', 'production'].join('-');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

describe('dev capture scripts (PRC-L413)', () => {
  it('no script contains the literal default dev secret', () => {
    const offenders = readdirSync(SCRIPTS_DIR)
      .filter((f) => f.endsWith('.mjs'))
      .filter((f) => readFileSync(path.join(SCRIPTS_DIR, f), 'utf8').includes(DEFAULT_SECRET));
    expect(offenders).toEqual([]);
  });

  it.each(['capture-institutions-timetable.mjs', 'capture-institutions-ux-live.mjs'])(
    '%s refuses to run without JWT_SECRET',
    (script) => {
      const result = spawnSync(process.execPath, [path.join('scripts', script)], {
        cwd: WEB_DIR,
        env: { ...process.env, JWT_SECRET: '' },
        timeout: 20_000,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/JWT_SECRET/);
    },
  );
});

describe('mock gateway (PRC-L413)', () => {
  let child: ChildProcess | undefined;
  let base = '';

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
    delete env.MOCK_GATEWAY_ALLOW_WRITES;
    const proc = spawn(process.execPath, [path.join(SCRIPTS_DIR, 'mock-gateway.mjs')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mock gateway did not start')), 15_000);
      proc.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      proc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`mock gateway exited early (${String(code)})`));
      });
    });
  }, 20_000);

  afterAll(() => {
    child?.kill();
  });

  it('serves GET reads', async () => {
    const res = await fetch(`${base}/api/v1/students`);
    expect(res.status).toBe(200);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects %s with 405 MOCK_READ_ONLY',
    async (method) => {
      const res = await fetch(`${base}/api/v1/students`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'DELETE' ? undefined : '{}',
      });
      expect(res.status).toBe(405);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('MOCK_READ_ONLY');
    },
  );
});
