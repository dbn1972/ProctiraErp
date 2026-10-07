/**
 * PRC-H095: durable lifecycle certificate persistence.
 *
 * These tests use a shared in-memory store behind a pg-shaped mock pool so two
 * independent repository instances (simulating a restart / second replica) see
 * the same rows — the exact property the old InMemoryLifecycleCertificateRepository
 * lacked. They would fail against a per-process in-memory store.
 */
import { describe, it, expect } from 'vitest';

import { PgLifecycleCertificateRepository } from './pg-repository.js';
import type { LifecycleCertificate } from './types.js';

type Row = Record<string, unknown>;

/** A tiny shared store + pg-shaped mock that understands the cert SQL. */
function createSharedMockPool() {
  const rows: Row[] = [];

  function run(text: string, values: unknown[] = []): { rows: Row[] } {
    const sql = text.trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('set_config')) return { rows: [] };

    if (sql.startsWith('INSERT INTO student_lifecycle_certificates')) {
      const [
        id,
        tenant_id,
        student_id,
        type,
        serial_number,
        status,
        issued_by,
        issued_at,
        revoked_at,
        revoke_reason,
        academic_year,
        remarks,
        checksum,
      ] = values;
      const row: Row = {
        id,
        tenant_id,
        student_id,
        type,
        serial_number,
        status,
        issued_by,
        issued_at,
        revoked_at,
        revoke_reason,
        academic_year,
        remarks,
        checksum,
      };
      rows.push(row);
      return { rows: [row] };
    }

    if (sql.includes('WHERE id = $1 AND tenant_id = $2') && sql.startsWith('SELECT')) {
      const [id, tenant_id] = values;
      const found = rows.find((r) => r['id'] === id && r['tenant_id'] === tenant_id);
      return { rows: found ? [found] : [] };
    }

    if (sql.includes('WHERE serial_number = $1 AND tenant_id = $2')) {
      const [serial, tenant_id] = values;
      const found = rows.find(
        (r) => r['serial_number'] === serial && r['tenant_id'] === tenant_id,
      );
      return { rows: found ? [found] : [] };
    }

    if (sql.includes('WHERE tenant_id = $1 AND student_id = $2')) {
      const [tenant_id, student_id] = values;
      return {
        rows: rows.filter(
          (r) => r['tenant_id'] === tenant_id && r['student_id'] === student_id,
        ),
      };
    }

    if (sql.startsWith('UPDATE student_lifecycle_certificates')) {
      const [id, tenant_id, status, touchRevoke, revoked_at, revoke_reason] = values;
      const found = rows.find((r) => r['id'] === id && r['tenant_id'] === tenant_id);
      if (!found) return { rows: [] };
      if (status !== null && status !== undefined) found['status'] = status;
      if (touchRevoke) {
        found['revoked_at'] = revoked_at;
        found['revoke_reason'] = revoke_reason;
      }
      return { rows: [found] };
    }

    throw new Error(`unexpected SQL: ${sql}`);
  }

  const client = {
    query: (text: string, values?: unknown[]) => Promise.resolve(run(text, values)),
    release: () => {},
  };

  return {
    connect: () => Promise.resolve(client),
    query: (text: string, values?: unknown[]) => Promise.resolve(run(text, values)),
    __rows: rows,
  };
}

function sampleCert(overrides: Partial<LifecycleCertificate> = {}): LifecycleCertificate {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    studentId: 'student-1',
    type: 'bonafide',
    serialNumber: 'BON-2026-0001',
    status: 'issued',
    issuedBy: 'registrar-1',
    issuedAt: new Date('2026-01-02T00:00:00.000Z'),
    revokedAt: null,
    revokeReason: null,
    academicYear: '2025-2026',
    remarks: null,
    checksum: 'abc123',
    ...overrides,
  };
}

describe('PgLifecycleCertificateRepository (PRC-H095)', () => {
  it('persists an issued certificate and finds it by serial after a "restart"', async () => {
    const pool = createSharedMockPool();
    const repo1 = new PgLifecycleCertificateRepository(pool);
    const cert = sampleCert();
    await repo1.create(cert);

    // Simulate restart / second replica: a brand new repo instance over the
    // same durable store must still see the certificate.
    const repo2 = new PgLifecycleCertificateRepository(pool);
    const bySerial = await repo2.findBySerial(cert.tenantId, cert.serialNumber);
    expect(bySerial).not.toBeNull();
    expect(bySerial?.id).toBe(cert.id);
    expect(bySerial?.status).toBe('issued');
  });

  it('revocation persists across instances (not lost on restart)', async () => {
    const pool = createSharedMockPool();
    const repo1 = new PgLifecycleCertificateRepository(pool);
    const cert = sampleCert();
    await repo1.create(cert);

    await repo1.update(cert.tenantId, cert.id, {
      status: 'revoked',
      revokedAt: new Date('2026-02-01T00:00:00.000Z'),
      revokeReason: 'issued in error',
    });

    const repo2 = new PgLifecycleCertificateRepository(pool);
    const after = await repo2.findById(cert.tenantId, cert.id);
    expect(after?.status).toBe('revoked');
    expect(after?.revokeReason).toBe('issued in error');
    expect(after?.revokedAt).not.toBeNull();
  });

  it('is tenant-scoped: another tenant cannot read the serial', async () => {
    const pool = createSharedMockPool();
    const repo = new PgLifecycleCertificateRepository(pool);
    const cert = sampleCert();
    await repo.create(cert);

    const otherTenant = '33333333-3333-4333-8333-333333333333';
    const leaked = await repo.findBySerial(otherTenant, cert.serialNumber);
    expect(leaked).toBeNull();
  });

  it('lists a student certificates newest-first', async () => {
    const pool = createSharedMockPool();
    const repo = new PgLifecycleCertificateRepository(pool);
    await repo.create(sampleCert());
    const list = await repo.listByStudent(sampleCert().tenantId, 'student-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.serialNumber).toBe('BON-2026-0001');
  });
});
