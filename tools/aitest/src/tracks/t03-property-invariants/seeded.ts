/**
 * Read-only sanity checks of the same invariants on the seeded Sunrise tenant
 * (db/seeds/006 + UAT detail records). The properties create their own random
 * tenants; these cases only prove that the invariants also hold on the demo
 * data a school sees first. Nothing is written.
 */
import { withPgTenant } from '@proctira/database';

import type { ResultsRecorder } from '../../foundation/index.js';
import { TENANTS } from '../../foundation/index.js';

import { ViolationLog } from './core.js';
import { loadFeesSnapshot } from './fees-live.js';
import {
  checkFeesSnapshot,
  emptyFeesModel,
  FEES_INVARIANTS,
  type FeesModel,
} from './fees-model.js';
import { schemeValid, type Threshold } from './grades-model.js';

type Pool = Parameters<typeof loadFeesSnapshot>[0];

const SNAPSHOT_INVARIANTS = FEES_INVARIANTS.map((i) => i.id).filter(
  (id) =>
    ![
      'model-agreement',
      'no-unexpected-error',
      'reports-match-ledger',
      'netting-within-disbursement',
    ].includes(id),
);

export async function runSeededChecks(recorder: ResultsRecorder, pool: Pool): Promise<void> {
  const tenantId = TENANTS.S.id;

  // Fees: model derived from the stored rows (issued = face + adjustment lines).
  const s = await loadFeesSnapshot(pool, tenantId);
  const m: FeesModel = emptyFeesModel();
  for (const inv of s.invoices) {
    const sum = (
      rows: Array<{ invoiceId: string | null; amount: number | null; status: string }>,
      st: string,
    ) =>
      rows
        .filter((r) => r.invoiceId === inv.id && r.status === st)
        .reduce((a, r) => a + (r.amount ?? 0), 0);
    const conc = s.concessions.filter((c) => c.invoiceId === inv.id && c.status === 'approved');
    const manualJournals = new Set(
      conc.filter((c) => !c.sourceDisbursementId && c.journalId).map((c) => c.journalId),
    );
    const manual = s.ledger
      .filter(
        (l) => manualJournals.has(l.journalId) && l.account === 'fee_revenue' && l.side === 'debit',
      )
      .reduce((a, l) => a + l.amount, 0);
    const netting = conc
      .filter((c) => c.sourceDisbursementId)
      .reduce((a, c) => a + (c.amount ?? 0), 0);
    m.invoices.push({
      id: inv.id,
      number: inv.id.slice(0, 8),
      kind: inv.structureId ? 'structure' : 'adhoc',
      structureId: inv.structureId,
      issued:
        inv.face + sum(s.creditNotes, 'posted') + sum(s.writeOffs, 'posted') + manual + netting,
      face: inv.face,
      status: inv.status as FeesModel['invoices'][number]['status'],
      payments: s.payments
        .filter((p) => p.invoiceId === inv.id && p.status === 'succeeded')
        .map((p) => ({
          id: p.id,
          amount: p.amount,
          refunded: s.refunds
            .filter((r) => r.paymentId === p.id && r.status === 'posted')
            .reduce((a, r) => a + r.amount, 0),
        })),
    });
  }
  const log = new ViolationLog(new Set(FEES_INVARIANTS.map((i) => i.id)));
  checkFeesSnapshot(log, m, s);
  for (const inv of SNAPSHOT_INVARIANTS) {
    const v = log.violations.get(inv);
    recorder.record(`seed:fees:${inv}`, v === undefined, {
      detail: v
        ? `${v.count} violation(s) on Sunrise: ${v.firstDetail}`
        : `${s.invoices.length} invoices, ${s.ledger.length} ledger legs, ${s.payments.length} payments`,
    });
  }

  // Grades: seeded gradebook scales and assessment schemes.
  const { bands, entries, schemes } = await withPgTenant(pool, tenantId, async (c) => {
    const b = await c.query(
      `SELECT gs.id AS scale_id, gs.code, gs.is_default, gb.label, gb.min_percent, gb.max_percent
         FROM grading_scales gs JOIN grading_scale_bands gb ON gb.grading_scale_id = gs.id
        WHERE gs.tenant_id = $1 AND gs.deleted_at IS NULL`,
      [tenantId],
    );
    const e = await c.query(
      `SELECT id, numeric_score, letter_grade FROM grade_entries WHERE tenant_id = $1`,
      [tenantId],
    );
    const sc = await c.query(
      `SELECT id, name, min_value, max_value, thresholds FROM grading_schemes WHERE tenant_id = $1`,
      [tenantId],
    );
    return {
      bands: b.rows as Array<Record<string, unknown>>,
      entries: e.rows as Array<Record<string, unknown>>,
      schemes: sc.rows as Array<Record<string, unknown>>,
    };
  });
  const byScale = new Map<string, Array<{ label: string; min: number; max: number }>>();
  for (const b of bands) {
    const list = byScale.get(String(b.code)) ?? [];
    list.push({ label: String(b.label), min: Number(b.min_percent), max: Number(b.max_percent) });
    byScale.set(String(b.code), list);
  }
  const scaleProblems: string[] = [];
  for (const [code, list] of byScale) {
    const sorted = [...list].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]!.min <= sorted[i - 1]!.max)
        scaleProblems.push(`${code}: ${sorted[i - 1]!.label}/${sorted[i]!.label} overlap`);
    }
    if (sorted[0]!.min > 0 || sorted.at(-1)!.max < 100)
      scaleProblems.push(`${code}: does not cover 0-100`);
  }
  recorder.record(
    'seed:grades:scale-bands-no-overlap',
    byScale.size > 0 && scaleProblems.length === 0,
    {
      detail: scaleProblems.join('; ') || `${byScale.size} seeded scale(s), ${bands.length} bands`,
    },
  );
  const labels = new Set(bands.map((b) => String(b.label)));
  const badLetters = entries.filter(
    (e) => e.letter_grade != null && !labels.has(String(e.letter_grade)),
  );
  recorder.record('seed:grades:entry-letter-in-scale', badLetters.length === 0, {
    detail: badLetters.length
      ? `${badLetters.length} seeded entries carry letters outside the seeded scales: ${badLetters.map((e) => String(e.letter_grade)).join(',')}`
      : `${entries.length} seeded grade entries`,
  });
  const invalid = schemes.filter(
    (sc) =>
      !schemeValid(Number(sc.min_value), Number(sc.max_value), (sc.thresholds ?? []) as Threshold[])
        .ok,
  );
  recorder.record('seed:grades:scheme-contiguous', invalid.length === 0, {
    detail: invalid.length
      ? invalid
          .map(
            (sc) =>
              `${String(sc.name)}: ${schemeValid(Number(sc.min_value), Number(sc.max_value), (sc.thresholds ?? []) as Threshold[]).why}`,
          )
          .join('; ')
      : `${schemes.length} seeded grading scheme(s)`,
  });
  recorder.record('seed:payroll:runs', 'skip', {
    reason:
      'the synthetic seed has no staff_payroll_runs rows for Sunrise; payroll is covered by the property only',
  });
}
