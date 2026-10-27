/**
 * Tests for the plugin CLI entry (PRC-L486: previously untested SDK area).
 *
 * The CLI runs main() on import and reads process.argv / process.cwd(), so
 * each case resets the module registry, points cwd at a temp directory and
 * records process.exit calls instead of exiting. Only the help, unknown
 * command and `validate` paths are covered; the printed-only init/dev/test/
 * build commands are a separate finding (PRC-M605) and are not pinned here.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import exportPlugin from '../../examples/export-plugin/index.js';

const VALID_MANIFEST = JSON.stringify(exportPlugin.manifest);

describe('plugin CLI', () => {
  const originalArgv = process.argv;
  const dirs: string[] = [];
  let exitCodes: Array<number | undefined>;
  let logs: string[];
  let errors: string[];
  let cwd: string;

  beforeEach(async () => {
    vi.resetModules();
    cwd = await mkdtemp(join(tmpdir(), 'plugin-cli-'));
    dirs.push(cwd);
    exitCodes = [];
    logs = [];
    errors = [];
    vi.spyOn(process, 'cwd').mockImplementation(() => cwd);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCodes.push(code);
    }) as typeof process.exit);
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function runCli(...args: string[]): Promise<void> {
    process.argv = ['node', 'proctira-plugin', ...args];
    // @ts-expect-error the CLI entry is a script with no exports (TS2306).
    await import('./index.js');
  }

  it('prints help and does not exit when no command is given', async () => {
    await runCli();
    await vi.waitFor(() => expect(logs.some((l) => l.includes('Usage:'))).toBe(true));
    expect(exitCodes).toEqual([]);
  });

  it('exits 1 for an unknown command', async () => {
    await runCli('frobnicate');
    await vi.waitFor(() => expect(exitCodes[0]).toBe(1));
    expect(errors.some((e) => e.includes('Unknown command: frobnicate'))).toBe(true);
  });

  it('validate accepts a valid ./manifest.json', async () => {
    await writeFile(join(cwd, 'manifest.json'), VALID_MANIFEST);
    await runCli('validate');
    await vi.waitFor(() => expect(logs.some((l) => l.includes('Manifest is valid'))).toBe(true));
    expect(exitCodes).toEqual([]);
  });

  it('validate finds the manifest under ./src', async () => {
    await mkdir(join(cwd, 'src'));
    await writeFile(join(cwd, 'src', 'manifest.json'), VALID_MANIFEST);
    await runCli('validate');
    await vi.waitFor(() => expect(logs.some((l) => l.includes('Manifest is valid'))).toBe(true));
    expect(exitCodes).toEqual([]);
  });

  it('validate exits 1 for an unknown required extension point', async () => {
    const manifest = {
      ...exportPlugin.manifest,
      requiredExtensionPoints: ['no.such.extension-point'],
    };
    await writeFile(join(cwd, 'manifest.json'), JSON.stringify(manifest));
    await runCli('validate');
    await vi.waitFor(() => expect(exitCodes[0]).toBe(1));
    expect(errors.some((e) => e.includes('validation failed'))).toBe(true);
  });

  it('validate exits 1 when no manifest is found (PRC-L482 fail closed)', async () => {
    await runCli('validate');
    await vi.waitFor(() => expect(exitCodes[0]).toBe(1));
    expect(errors[0]).toContain('No manifest.json found');
  });

  it('validate exits 1 for malformed JSON', async () => {
    await writeFile(join(cwd, 'manifest.json'), '{ not json');
    await runCli('validate');
    await vi.waitFor(() => expect(exitCodes[0]).toBe(1));
    expect(errors.some((e) => e.includes('Failed to validate'))).toBe(true);
  });
});
