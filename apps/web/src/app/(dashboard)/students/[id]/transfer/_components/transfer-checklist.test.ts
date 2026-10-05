import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTransferChecklist } from './transfer-checklist';

const consent = (granted: boolean, recordedAt = '2025-01-01T00:00:00Z') => ({
  id: 'c',
  studentId: 's',
  kind: 'data_sharing' as const,
  granted,
  actorId: 'a',
  recordedAt,
});

describe('PRC-M483 transfer checklist', () => {
  it('a student with an unpaid invoice has the fees item outstanding', () => {
    const items = buildTransferChecklist({
      invoices: [{ status: 'paid' }, { status: 'open' }],
      discipline: [],
      consents: [consent(true)],
    });
    expect(items.find((i) => i.key === 'fees')).toMatchObject({ state: 'outstanding' });
    expect(items.find((i) => i.key === 'discipline')).toMatchObject({ state: 'done' });
    expect(items.find((i) => i.key === 'consent')).toMatchObject({ state: 'done' });
  });

  it('a student with no invoices has fees done', () => {
    const items = buildTransferChecklist({ invoices: [], discipline: [], consents: [] });
    expect(items.find((i) => i.key === 'fees')).toMatchObject({ state: 'done' });
    expect(items.find((i) => i.key === 'consent')).toMatchObject({ state: 'outstanding' });
  });

  it('failed reads are "unknown", never done', () => {
    const items = buildTransferChecklist({ invoices: null, discipline: null, consents: null });
    expect(items.every((i) => i.state === 'unknown')).toBe(true);
  });

  it('uses the latest consent decision', () => {
    const items = buildTransferChecklist({
      invoices: [],
      discipline: [],
      consents: [consent(true, '2025-01-01T00:00:00Z'), consent(false, '2025-02-01T00:00:00Z')],
    });
    expect(items.find((i) => i.key === 'consent')).toMatchObject({ state: 'outstanding' });
  });

  it('the page carries no static done:true data', () => {
    const src = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');
    expect(src).not.toMatch(/done:\s*true/);
    expect(src).not.toContain('APPROVAL_STEPS');
  });
});
