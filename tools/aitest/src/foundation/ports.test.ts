import { describe, expect, it } from 'vitest';

import {
  assertPortsFree,
  boundPorts,
  parseListeners,
  PORT_BLOCK_SIZE,
  PORT_OFFSETS,
  portsFor,
  resolveUnit,
  UNIT_PORT_BASES,
  waitPortsUnbound,
} from './ports.js';

describe('port blocks', () => {
  it('has every unit of the program CONVENTIONS section 1 table with its base', () => {
    const expected: Record<string, number> = {
      't01-permission-matrix': 34000,
      't02-cross-tenant-idor': 34050,
      't03-property-invariants': 34100,
      't04-model-based-workflows': 34150,
      't05-concurrency-races': 34200,
      't06-compressed-year': 34250,
      't08-resilience-recovery': 34350,
      't09-security-probing': 34400,
      't10-personal-data-flow': 34450,
      't11-accessibility': 34500,
      't12-persona-uat': 34550,
      't13-statutory-reports': 34600,
      't14-mutation-testing': 34650,
      'fix-security': 34700,
      'fix-money-grades': 34750,
      'fix-other': 34800,
      restore: 34850,
      wave1: 34900,
      wave2: 34900,
      wave3: 34900,
      wave4: 34900,
      foundation: 34950,
    };
    expect(UNIT_PORT_BASES).toEqual(expected);
  });

  it('gives every non-wave unit its own 50-port block inside 34000-34999', () => {
    const bases = Object.entries(UNIT_PORT_BASES)
      .filter(([u]) => !/^wave\d$/.test(u))
      .map(([, b]) => b);
    expect(new Set(bases).size).toBe(bases.length);
    for (const b of Object.values(UNIT_PORT_BASES)) {
      expect(b % PORT_BLOCK_SIZE).toBe(0);
      expect(b).toBeGreaterThanOrEqual(34000);
      expect(b + PORT_BLOCK_SIZE - 1).toBeLessThanOrEqual(34999);
    }
  });

  it('keeps offsets inside the block and maps them', () => {
    for (const off of Object.values(PORT_OFFSETS)) expect(off).toBeLessThan(PORT_BLOCK_SIZE);
    const p = portsFor(34950);
    expect(p.postgres).toBe(34950);
    expect(p.gateway).toBe(34960);
    expect(p.gateway2).toBe(34961);
    expect(p.web).toBe(34970);
    expect(p.keycloak).toBe(34957);
    expect(() => portsFor(34951)).toThrow(/multiple of 50/);
    expect(() => portsFor(35000)).toThrow(/outside the program range/);
  });

  it('resolves unit names to projects', () => {
    expect(resolveUnit('foundation')).toEqual({
      unit: 'foundation',
      project: 'proctira-aitest-foundation',
      portBase: 34950,
    });
    expect(resolveUnit('ci-x', { portBase: 34000, project: 'proctira-aitest-ci-x' }).project).toBe(
      'proctira-aitest-ci-x',
    );
    expect(() => resolveUnit('nope')).toThrow(/unknown unit/);
    expect(() => resolveUnit('foundation', { project: 'proctira-erp' })).toThrow(/proctira-aitest/);
    expect(() => resolveUnit('Bad Unit')).toThrow();
  });
});

describe('assertPortsFree', () => {
  const ss = [
    'LISTEN 0 511 127.0.0.1:34960 0.0.0.0:* users:(("node",pid=4242,fd=21))',
    'LISTEN 0 4096 *:22 *:*',
    'LISTEN 0 4096 [::1]:34951 [::]:*',
  ].join('\n');

  it('parses ss output', () => {
    expect(parseListeners(ss)).toEqual([
      { port: 34960, address: '127.0.0.1', process: 'node pid 4242' },
      { port: 22, address: '*' },
      { port: 34951, address: '[::1]' },
    ]);
  });

  it('finds ports held by non-listening sockets, ignoring TIME-WAIT', async () => {
    const all = [
      'ESTAB 0 0 127.0.0.1:34960 127.0.0.1:34950',
      'TIME-WAIT 0 0 127.0.0.1:34961 127.0.0.1:41000',
      'LISTEN 0 511 127.0.0.1:34962 0.0.0.0:*',
    ].join('\n');
    expect(
      await boundPorts([34960, 34961, 34962, 34963], { listSockets: async () => all }),
    ).toEqual([34960, 34962]);
    await expect(
      waitPortsUnbound([34960], { listSockets: async () => all, timeoutMs: 20, pollMs: 5 }),
    ).rejects.toThrow(/ip_local_reserved_ports/);
    await expect(
      waitPortsUnbound([34961], { listSockets: async () => all }),
    ).resolves.toBeUndefined();
  });

  it('names the holder of a busy port', async () => {
    await expect(assertPortsFree([34960, 34950], { listSockets: async () => ss })).rejects.toThrow(
      /34960 \(127\.0\.0\.1, node pid 4242\)/,
    );
    await expect(assertPortsFree([34951], { listSockets: async () => ss })).rejects.toThrow(
      /holder not visible/,
    );
    await expect(
      assertPortsFree([34950], { listSockets: async () => ss }),
    ).resolves.toBeUndefined();
  });
});
