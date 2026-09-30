import { existsSync, readFileSync, rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { TEMPLATE_PATH, generatePgloaderConfig } from './pgloader-config.js';

/** PRC-H104: the pgloader step read a template that did not exist, so no migration could start. */
describe('generatePgloaderConfig', () => {
  let output: string | null = null;
  afterEach(() => {
    if (output && existsSync(output)) rmSync(output);
    output = null;
  });

  it('points at a template that ships with the repo', () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
  });

  it('substitutes every placeholder', () => {
    output = generatePgloaderConfig({
      mysql: { user: 'mu', password: 'mp', host: 'mysql.local', port: 3307, database: 'legacy' },
      pg: { user: 'pu', password: 'pp', host: 'pg.local', port: 5433, database: 'proctira' },
    } as never);
    const text = readFileSync(output, 'utf-8');
    expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(text).toContain('mysql://mu:mp@mysql.local:3307/legacy');
    expect(text).toContain('postgresql://pu:pp@pg.local:5433/proctira');
  });
});
