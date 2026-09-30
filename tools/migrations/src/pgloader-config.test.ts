import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  TEMPLATE_PATH,
  generatePgloaderConfig,
  removeGeneratedPgloaderConfig,
} from './pgloader-config.js';

const base = {
  mysql: { user: 'mu', password: 'p@ss:w/rd', host: 'mysql.local', port: 3307, database: 'legacy' },
  pg: { user: 'pu', password: 'pp', host: 'pg.local', port: 5433, database: 'proctira' },
  stagingSchema: 'migration_staging',
};

/** PRC-H104: the pgloader step read a template that did not exist, so no migration could start. */
describe('generatePgloaderConfig', () => {
  let output: string | null = null;
  afterEach(() => {
    if (output) removeGeneratedPgloaderConfig(output);
    output = null;
  });

  it('points at a template that ships with the repo', () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
  });

  it('substitutes every placeholder, URL-encoding credentials', () => {
    output = generatePgloaderConfig(base as never);
    const text = readFileSync(output, 'utf-8');
    expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(text).toContain('mysql://mu:p%40ss%3Aw%2Frd@mysql.local:3307/legacy');
    expect(text).toContain('postgresql://pu:pp@pg.local:5433/proctira');
  });

  it('writes credentials to a private temp file, never into the repo', () => {
    output = generatePgloaderConfig(base as never);
    expect(output.startsWith(resolve(TEMPLATE_PATH, '..'))).toBe(false);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    removeGeneratedPgloaderConfig(output);
    expect(existsSync(output)).toBe(false);
    output = null;
  });

  it('substitutes a configured staging schema and rejects unsafe names', () => {
    output = generatePgloaderConfig({ ...base, stagingSchema: 'legacy_stage' } as never);
    const text = readFileSync(output, 'utf-8');
    expect(text).toContain("search_path to 'legacy_stage'");
    expect(text).not.toContain('migration_staging');
    expect(() => generatePgloaderConfig({ ...base, stagingSchema: 'x; drop' } as never)).toThrow();
  });
});
