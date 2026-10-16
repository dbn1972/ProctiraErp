/**
 * @vitest-environment node
 *
 * PRC-L412 — report generate/schedule server-action unit tests. Covers
 * validation (missing template, bad schedule), success mapping and the
 * result-object error path, asserting the gateway is not called on a
 * validation failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateReport = vi.fn();
const createReportSchedule = vi.fn();
const setReportScheduleEnabled = vi.fn();
const deleteReportSchedule = vi.fn();
const runReportSchedule = vi.fn();
const runDueReportSchedules = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/data-warehouse', () => ({ createImportJob: vi.fn() }));
vi.mock('@/lib/reports/api', () => ({
  generateReport: (...a: unknown[]) => generateReport(...a),
  createReportSchedule: (...a: unknown[]) => createReportSchedule(...a),
  setReportScheduleEnabled: (...a: unknown[]) => setReportScheduleEnabled(...a),
  deleteReportSchedule: (...a: unknown[]) => deleteReportSchedule(...a),
  runReportSchedule: (...a: unknown[]) => runReportSchedule(...a),
  runDueReportSchedules: (...a: unknown[]) => runDueReportSchedules(...a),
}));

import {
  createReportScheduleAction,
  deleteReportScheduleAction,
  generateReportAction,
  runReportScheduleAction,
} from './actions';

const SCHEDULE_ID = '44444444-4444-4444-8444-444444444444';

describe('report actions (PRC-L412)', () => {
  beforeEach(() => {
    for (const m of [
      generateReport,
      createReportSchedule,
      setReportScheduleEnabled,
      deleteReportSchedule,
      runReportSchedule,
      runDueReportSchedules,
    ])
      m.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('generateReportAction rejects a missing template with field errors, no gateway call', async () => {
    const res = await generateReportAction({ templateId: '', format: 'PDF' } as never);
    expect(res.status).toBe('error');
    expect(res.fieldErrors).toBeTruthy();
    expect(generateReport).not.toHaveBeenCalled();
  });

  it('generateReportAction returns the run and sha on success', async () => {
    generateReport.mockResolvedValue({
      run: {
        id: 'r1',
        templateId: 'enrolment',
        status: 'COMPLETED',
        sha256: 'abc',
        artifactId: 'a1',
      },
      source: 'live',
    });
    const res = await generateReportAction({ templateId: 'enrolment', format: 'PDF' } as never);
    expect(res.status).toBe('success');
    expect(res.sha256).toBe('abc');
    expect(res.id).toBe('r1');
  });

  it('generateReportAction surfaces the api error when no run returned', async () => {
    generateReport.mockResolvedValue({ run: null, error: 'template disabled', source: 'live' });
    const res = await generateReportAction({ templateId: 'enrolment', format: 'CSV' } as never);
    expect(res.status).toBe('error');
    expect(res.message).toBe('template disabled');
  });

  it('createReportScheduleAction rejects a bad recipient before the gateway', async () => {
    const res = await createReportScheduleAction({
      reportKey: 'enrolment',
      format: 'PDF',
      cadence: 'daily',
      hour: 6,
      recipients: 'not-an-email',
    });
    expect(res.status).toBe('error');
    expect(res.fieldErrors).toBeTruthy();
    expect(createReportSchedule).not.toHaveBeenCalled();
  });

  it('createReportScheduleAction succeeds with valid recipients', async () => {
    createReportSchedule.mockResolvedValue({
      schedule: { id: SCHEDULE_ID, cadence: 'daily', hour: 6 },
      source: 'live',
    });
    const res = await createReportScheduleAction({
      reportKey: 'enrolment',
      format: 'PDF',
      cadence: 'daily',
      hour: 6,
      recipients: 'ops@example.org',
    });
    expect(res.status).toBe('success');
    expect(res.id).toBe(SCHEDULE_ID);
  });

  it('deleteReportScheduleAction rejects a non-uuid id before the gateway', async () => {
    const res = await deleteReportScheduleAction('nope');
    expect(res.status).toBe('error');
    expect(deleteReportSchedule).not.toHaveBeenCalled();
  });

  it('runReportScheduleAction surfaces the api error when no run returned', async () => {
    runReportSchedule.mockResolvedValue({ run: null, error: 'schedule paused' });
    const res = await runReportScheduleAction(SCHEDULE_ID);
    expect(res.status).toBe('error');
    expect(res.message).toBe('schedule paused');
  });
});
