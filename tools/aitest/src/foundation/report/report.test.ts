import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { csvCell, FINDINGS_HEADER, FindingsWriter } from './findings.js';
import { loadPendingFixes } from './pending.js';
import { outcomeFor, ResultsRecorder } from './results.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'aitest-report-'));

describe('FindingsWriter', () => {
  it('numbers findings per track and quotes CSV cells', () => {
    const out = tmp();
    const w = new FindingsWriter(out, '01');
    const base = {
      severity: 'high',
      category: 'tenancy',
      module: 'students',
      expected: '403',
      actual: '200',
      patch: '',
      prc_match: '',
    } as const;
    expect(w.add({ ...base, title: 'plain', evidence: 'e' }).id).toBe('AIT-T01-001');
    const f = w.add({ ...base, title: 'has, comma', evidence: 'line1\nline2 "quoted"' });
    expect(f).toMatchObject({ id: 'AIT-T01-002', track: 't01' });
    const csv = readFileSync(w.write(), 'utf8').split('\n');
    expect(csv[0]).toBe(FINDINGS_HEADER);
    expect(csv[1]).toBe('AIT-T01-001,t01,high,tenancy,students,plain,e,403,200,,');
    expect(csv.slice(2, 4).join('\n')).toBe(
      'AIT-T01-002,t01,high,tenancy,students,"has, comma","line1\nline2 ""quoted""",403,200,,',
    );
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(() => new FindingsWriter(out, '1')).toThrow(/two digits/);
  });
});

describe('pending fixes and results', () => {
  it('maps outcomes', () => {
    expect(outcomeFor(true)).toBe('pass');
    expect(outcomeFor(false)).toBe('fail');
    expect(outcomeFor('skip', 'AIT-T01-001')).toBe('skip');
    expect(outcomeFor(false, 'AIT-T01-001')).toBe('pending-fix');
    expect(outcomeFor(true, 'AIT-T01-001')).toBe('fixed-pending-restore');
  });

  it('loads pending-fixes.json and validates finding ids', () => {
    const dir = tmp();
    expect(loadPendingFixes(dir).size).toBe(0);
    writeFileSync(
      join(dir, 'pending-fixes.json'),
      JSON.stringify({ $comment: 'x', cases: { 'c-1': 'AIT-T02-004' } }),
    );
    expect([...loadPendingFixes(dir)]).toEqual([['c-1', 'AIT-T02-004']]);
    writeFileSync(
      join(dir, 'pending-fixes.json'),
      JSON.stringify({ cases: { 'c-1': 'PRC-H001' } }),
    );
    expect(() => loadPendingFixes(dir)).toThrow(/finding id/);
  });

  it('counts cases, applies pending fixes and writes results.md/json', () => {
    const trackDir = tmp();
    mkdirSync(trackDir, { recursive: true });
    writeFileSync(
      join(trackDir, 'pending-fixes.json'),
      JSON.stringify({ cases: { b: 'AIT-T01-001', c: 'AIT-T01-002' } }),
    );
    const out = tmp();
    const r = new ResultsRecorder(out, 't01-permission-matrix', { trackDir });
    expect(r.record('a', true)).toBe('pass');
    expect(r.record('b', false, { detail: 'still 200' })).toBe('pending-fix');
    expect(r.record('c', true)).toBe('fixed-pending-restore');
    expect(r.record('d', 'skip', { reason: 'no fixture id' })).toBe('skip');
    expect(r.record('e', false, { detail: 'x|y' })).toBe('fail');
    expect(() => r.record('a', true)).toThrow(/twice/);
    expect(() => r.record('f', 'skip')).toThrow(/reason/);
    r.coverage('routes', 3, 4);
    expect(r.summary().counts).toEqual({
      run: 4,
      pass: 1,
      fail: 1,
      skip: 1,
      'pending-fix': 1,
      'fixed-pending-restore': 1,
    });
    expect(r.failures().map((c) => c.caseId)).toEqual(['e']);
    const { json, md } = r.write();
    expect(JSON.parse(readFileSync(json, 'utf8')).counts.fail).toBe(1);
    const text = readFileSync(md, 'utf8');
    expect(text).toContain('| 4 | 1 | 1 | 1 | 1 | 1 |');
    expect(text).toContain('| routes | 3 | 4 | 75.0 |');
    expect(text).toContain('| b | pending-fix | AIT-T01-001 | still 200 |');
    expect(text).toContain('x\\|y');
  });
});
