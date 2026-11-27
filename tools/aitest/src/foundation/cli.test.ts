import { describe, expect, it } from 'vitest';

import { parseArgs, stackOptionsFrom } from './cli.js';

describe('cli', () => {
  it('parses stack up flags', () => {
    const p = parseArgs([
      'stack',
      'up',
      '--unit',
      't09-security-probing',
      '--profile',
      'full',
      '--keycloak',
      '--gateways',
      '2',
      '--web',
      'web,admin-console',
      '--node-env',
      'production',
      '--no-seed',
      '--port-base=34400',
    ]);
    expect(p.positional).toEqual(['stack', 'up']);
    expect(stackOptionsFrom(p)).toEqual({
      unit: 't09-security-probing',
      profile: 'full',
      gateways: 2,
      webApps: ['web', 'admin-console'],
      keycloak: true,
      nodeEnv: 'production',
      seed: false,
      portBase: 34400,
    });
  });

  it('rejects bad values', () => {
    expect(() => stackOptionsFrom(parseArgs(['--profile', 'core']))).toThrow(/--unit/);
    expect(() => stackOptionsFrom(parseArgs(['--unit', 'u', '--web', 'nope']))).toThrow(
      /unknown web app/,
    );
    expect(() => stackOptionsFrom(parseArgs(['--unit', 'u', '--gateways', '3']))).toThrow(
      /0, 1 or 2/,
    );
    expect(() => stackOptionsFrom(parseArgs(['--unit', 'u', '--port-base', 'x']))).toThrow(
      /integer/,
    );
  });
});
