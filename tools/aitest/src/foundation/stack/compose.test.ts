import { describe, expect, it } from 'vitest';

import { portsFor } from '../ports.js';

import { assertAitestProject, buildComposeArgs, expandPlaceholders } from './compose.js';
import { generateSecrets, renderEnvFile } from './secrets.js';

const t = {
  project: 'proctira-aitest-foundation',
  repoRoot: '/repo',
  envFile: '/state/aitest.env',
};

describe('buildComposeArgs', () => {
  it('always pins the project, both compose files and the env file', () => {
    expect(buildComposeArgs(t, ['up', '-d', 'postgres'])).toEqual([
      'compose',
      '-p',
      'proctira-aitest-foundation',
      '--project-directory',
      '/repo',
      '-f',
      '/repo/docker-compose.yml',
      '-f',
      '/repo/tools/aitest/stack/docker-compose.aitest.yml',
      '--env-file',
      '/state/aitest.env',
      'up',
      '-d',
      'postgres',
    ]);
  });

  it('appends extra overlays relative to tools/aitest', () => {
    const args = buildComposeArgs(
      { ...t, extraComposeFiles: ['src/tracks/t08/toxiproxy.yml', '/abs/x.yml'] },
      ['ps'],
    );
    expect(args).toContain('/repo/tools/aitest/src/tracks/t08/toxiproxy.yml');
    expect(args.indexOf('/abs/x.yml')).toBeLessThan(args.indexOf('--env-file'));
  });

  it.each([
    'proctira-erp',
    'proctira-uatenv',
    'proctira-staging',
    'serviceformai',
    'proctira-aitest-',
    'PROCTIRA-AITEST-X',
  ])('refuses project %s', (project) => {
    expect(() => buildComposeArgs({ ...t, project }, ['ps'])).toThrow(/refusing compose project/);
    expect(() => assertAitestProject(project)).toThrow();
  });

  it.each([
    [['system', 'prune', '-f']],
    [['volume', 'prune']],
    [['-p', 'proctira-erp', 'down']],
    [['down', '-p', 'other']],
    [['down', '--project-name=other']],
    [['up', '--env-file', '/other.env']],
    [[]],
  ])('refuses unsafe arguments %j', (args) => {
    expect(() => buildComposeArgs(t, args)).toThrow();
  });

  it('never puts a secret in argv', () => {
    const secrets = generateSecrets();
    const args = buildComposeArgs(t, ['up', '-d', '--wait', 'postgres', 'redis']).join(' ');
    for (const v of Object.values(secrets)) expect(args).not.toContain(v);
    const env = renderEnvFile(secrets, portsFor(34950), { unit: 'foundation' });
    expect(env).toContain(`JWT_SECRET=${secrets.jwtSecret}`);
  });
});

describe('expandPlaceholders', () => {
  it('expands the project dir and named ports', () => {
    expect(
      expandPlaceholders(
        {
          CLOCK_FILE: '${AITEST_PROJECT_DIR}/clock.json',
          PROXY: '127.0.0.1:${PORT:trackLocal}',
          PLAIN: 'x',
        },
        { projectDir: '/state/p', ports: portsFor(34250) },
      ),
    ).toEqual({ CLOCK_FILE: '/state/p/clock.json', PROXY: '127.0.0.1:34280', PLAIN: 'x' });
  });

  it('rejects unknown placeholders', () => {
    expect(() =>
      expandPlaceholders({ A: '${HOME}' }, { projectDir: '/p', ports: portsFor(34000) }),
    ).toThrow(/unknown placeholder/);
    expect(() =>
      expandPlaceholders({ A: '${PORT:nope}' }, { projectDir: '/p', ports: portsFor(34000) }),
    ).toThrow(/unknown port/);
  });
});
