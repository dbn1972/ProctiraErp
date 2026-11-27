import { describe, expect, it } from 'vitest';

import { diffSnapshots, isVolatile } from './snapshot.js';

describe('snapshots', () => {
  it('treats bookkeeping tables as volatile', () => {
    for (const t of [
      'audit_ingest_queue',
      'audit_logs',
      'health_phi_access_log',
      'notification_outbox',
      'user_sessions',
      'idempotency_keys',
      'rate_limit_buckets',
      'authz_denials',
      'control_plane_documents',
    ]) {
      expect(isVolatile(t)).toBe(true);
    }
    for (const t of ['students', 'fee_invoices', 'payroll_runs', 'grades'])
      expect(isVolatile(t)).toBe(false);
  });

  it('reports only changed tables', () => {
    const a = {
      tenantId: 't',
      takenAt: '',
      tables: { a: { count: 1, digest: 'x' }, b: { count: 2, digest: 'y' } },
    };
    const b = {
      tenantId: 't',
      takenAt: '',
      tables: {
        a: { count: 1, digest: 'x' },
        b: { count: 2, digest: 'z' },
        c: { count: 1, digest: 'q' },
      },
    };
    expect(diffSnapshots(a, a)).toEqual([]);
    expect(diffSnapshots(a, b).map((d) => d.table)).toEqual(['b', 'c']);
  });
});
