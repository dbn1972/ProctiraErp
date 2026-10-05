/**
 * PRC-H077: per-domain anonymizers and the Postgres tenant wipe executor,
 * exercised against a recording fake pg client.
 */
import { describe, expect, it } from 'vitest';
import {
  PgDomainSubjectAnonymizer,
  PgTenantWipeExecutor,
  classifyWipeTable,
  readFinanceHealthErasureMode,
} from './domain-anonymizers.js';
import { PrivacyService } from './privacy-service.js';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';

type Handler = (sql: string, values?: unknown[]) => { rows: unknown[]; rowCount?: number };

function fakePool(handler: Handler) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SELECT set_config)/.test(sql.trim())) {
        return { rows: [] };
      }
      return handler(sql, values);
    },
    release() {},
  };
  return { pool: { connect: async () => client, query: client.query }, queries };
}

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  subjectId: 'stu-1',
  requestType: 'anonymization' as const,
  jobId: 'job-1',
};

const isDiscovery = (sql: string) => sql.includes('information_schema.columns');
const isProbe = (sql: string) => /^SELECT 1 FROM "/.test(sql);

/** Student link discovery rows (table, column) as returned by information_schema. */
function linkRows(pairs: Array<[string, string]>) {
  return pairs.map(([table_name, column_name]) => ({ table_name, column_name, has_tenant: true }));
}

/** Happy-path student erasure with object eraser; overrides per test. */
function studentPool(overrides: { discovery?: Array<[string, string]>; probeHit?: string[] } = {}) {
  return fakePool((sql, values) => {
    if (isDiscovery(sql)) return { rows: linkRows(overrides.discovery ?? []) };
    if (isProbe(sql)) {
      const table = /^SELECT 1 FROM "([a-z_0-9]+)"/.exec(sql)![1]!;
      return { rows: overrides.probeHit?.includes(table) ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes('UPDATE students')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM student_documents')) return { rows: [{ id: 'd1', object_key: 'k1' }] };
    if (sql.includes('FROM student_photos')) return { rows: [{ object_key: 'p1' }] };
    void values;
    return { rows: [], rowCount: 1 };
  });
}

const eraser = (deleted: string[]) => ({
  async deleteObject(_t: string, key: string) {
    deleted.push(key);
  },
});

describe('PRC-H077 domain anonymizers', () => {
  it('defaults finance/health to retain and rejects unsupported modes', () => {
    expect(readFinanceHealthErasureMode({})).toBe('retain');
    expect(() => readFinanceHealthErasureMode({ ERASURE_FINANCE_HEALTH_MODE: 'delete' })).toThrow();
  });

  it('pseudonymises a student (incl. gender/search vector), deletes nothing financial, reports file residual', async () => {
    const { pool, queries } = studentPool();
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never);
    const result = await anonymizer.anonymize({ ...input, subjectType: 'student' });
    expect(result.fieldsTouched).toEqual(
      expect.arrayContaining([
        'students.first_name',
        'students.gender',
        'students.search_vector',
        'fees:retained_statutory(retain)',
        'health:retained_statutory(retain)',
      ]),
    );
    expect(result.residualNote).toMatch(/files: 1 stored object/);
    expect(result.residualNote).toMatch(/photos: 1 stored photo object/);
    expect(queries.some((q) => /fee|health/i.test(q.sql) && /UPDATE|DELETE/.test(q.sql))).toBe(
      false,
    );
    // Photo row is kept when its bytes cannot be erased.
    expect(queries.some((q) => q.sql.startsWith('DELETE FROM student_photos'))).toBe(false);
    // Tenant id is always a bound parameter.
    const update = queries.find((q) => q.sql.includes('UPDATE students'))!;
    expect(update.values).toContain(input.tenantId);
  });

  it('completes a student erasure with no residual when everything linked is handled', async () => {
    const deleted: string[] = [];
    const { pool, queries } = studentPool({
      discovery: [
        ['students', 'id'],
        ['student_documents', 'student_id'],
        ['student_photos', 'student_id'],
        ['student_siblings', 'student_id'],
        ['student_siblings', 'sibling_id'],
        ['parent_fee_invoices', 'student_id'], // retained
        ['grade_entries', 'student_id'], // pseudonymous
        ['student_discipline_incidents', 'student_id'], // unhandled, but no rows
      ],
    });
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never, {
      objectEraser: eraser(deleted),
    });
    const result = await anonymizer.anonymize({ ...input, subjectType: 'student' });
    expect(result.residualNote).toBeUndefined();
    expect(deleted.sort()).toEqual(['k1', 'p1']);
    expect(queries.some((q) => q.sql.startsWith('DELETE FROM student_photos'))).toBe(true);
    expect(queries.some((q) => /DELETE FROM student_siblings/.test(q.sql))).toBe(true);
    // Only the unhandled link is probed; handled/retained/pseudonymous are not.
    const probes = queries.filter((q) => isProbe(q.sql)).map((q) => q.sql);
    expect(probes).toHaveLength(1);
    expect(probes[0]).toContain('"student_discipline_incidents"');
    expect(probes[0]).toContain('tenant_id::text = $2');
  });

  it('fails closed with a residual when unhandled child-PII tables still hold rows', async () => {
    const { pool } = studentPool({
      discovery: [
        ['student_discipline_incidents', 'student_id'],
        ['student_consents', 'student_id'],
        ['admission_offers', 'enrolled_student_id'],
        ['brand_new_table', 'student_id'], // not in the registry
        ['enrollments', 'student_id'],
      ],
      probeHit: ['student_discipline_incidents', 'admission_offers', 'brand_new_table'],
    });
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never, {
      objectEraser: eraser([]),
    });
    const result = await anonymizer.anonymize({ ...input, subjectType: 'student' });
    expect(result.residualNote).toMatch(/coverage: subject-linked rows not anonymised/);
    expect(result.residualNote).toContain('student_discipline_incidents.student_id');
    expect(result.residualNote).toContain('admission_offers.enrolled_student_id');
    expect(result.residualNote).toContain('brand_new_table.student_id (unclassified)');
    expect(result.residualNote).not.toContain('student_consents');
    expect(result.residualNote).not.toContain('enrollments');
  });

  it('treats a handled link as uncovered when its anonymizer is not configured', async () => {
    const { pool } = studentPool({
      discovery: [['student_photos', 'student_id']],
      probeHit: ['student_photos'],
    });
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never, {
      domains: [
        {
          domain: 'students',
          covers: ['students.id'],
          appliesTo: (t) => t === 'student',
          async anonymize() {
            return { fieldsTouched: ['students.first_name'] };
          },
        },
      ],
    });
    const result = await anonymizer.anonymize({ ...input, subjectType: 'student' });
    expect(result.residualNote).toContain('student_photos.student_id');
  });

  it('reports a residual when discovery or a probe fails (never silently complete)', async () => {
    const discoveryFails = fakePool((sql) => {
      if (isDiscovery(sql)) throw new Error('permission denied for information_schema');
      return { rows: [], rowCount: 1 };
    });
    const r1 = await new PgDomainSubjectAnonymizer(discoveryFails.pool as never, {
      objectEraser: eraser([]),
    }).anonymize({ ...input, subjectType: 'student' });
    expect(r1.residualNote).toMatch(/coverage: subject-link discovery failed/);

    const probeFails = fakePool((sql) => {
      if (isDiscovery(sql)) return { rows: linkRows([['lms_submissions', 'student_id']]) };
      if (isProbe(sql)) throw new Error('relation missing');
      return { rows: [], rowCount: 1 };
    });
    const r2 = await new PgDomainSubjectAnonymizer(probeFails.pool as never, {
      objectEraser: eraser([]),
    }).anonymize({ ...input, subjectType: 'student' });
    expect(r2.residualNote).toMatch(
      /lms_submissions\.student_id \(probe failed: relation missing\)/,
    );
  });

  it('audits staff links too', async () => {
    const { pool } = fakePool((sql) => {
      if (isDiscovery(sql)) {
        return {
          rows: linkRows([
            ['staff', 'id'],
            ['staff_payroll_lines', 'staff_id'],
            ['hr_appraisals', 'staff_id'],
          ]),
        };
      }
      if (isProbe(sql)) return { rows: sql.includes('"hr_appraisals"') ? [{}] : [] };
      return { rows: [], rowCount: 1 };
    });
    const result = await new PgDomainSubjectAnonymizer(pool as never).anonymize({
      ...input,
      subjectType: 'teacher',
    });
    expect(result.residualNote).toBe(
      'coverage: subject-linked rows not anonymised in hr_appraisals.staff_id',
    );
  });

  it('reports a residual for unknown subject types and missing rows', async () => {
    const { pool } = fakePool(() => ({ rows: [], rowCount: 0 }));
    const anonymizer = new PgDomainSubjectAnonymizer(pool as never);
    expect((await anonymizer.anonymize({ ...input, subjectType: 'alien' })).residualNote).toMatch(
      /No domain anonymizer/,
    );
    expect((await anonymizer.anonymize({ ...input, subjectType: 'staff' })).residualNote).toMatch(
      /staff: subject row not found/,
    );
  });

  it('a coverage residual keeps the DSAR out of `completed` end-to-end', async () => {
    const { pool } = studentPool({
      discovery: [['student_discipline_incidents', 'student_id']],
      probeHit: ['student_discipline_incidents'],
    });
    const repository = new InMemoryPrivacyRepository();
    const service = new PrivacyService(repository, {
      anonymizer: new PgDomainSubjectAnonymizer(pool as never, { objectEraser: eraser([]) }),
    });
    const req = await service.createErasureRequest({
      tenantId: input.tenantId,
      subjectType: 'student',
      subjectId: input.subjectId,
      requestedBy: 'parent-1',
    });
    await service.transitionErasureRequest(req.id, input.tenantId, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, input.tenantId, 'approved', 'officer');
    const after = await service.executeErasure(req.id, input.tenantId, 'officer');
    expect(after.status).not.toBe('completed');
    expect(after.completedAt).toBeNull();
    const jobs = await repository.listAnonymizationJobs(input.tenantId);
    const job = jobs.find((j) => j.erasureRequestId === req.id)!;
    expect(job.status).toBe('failed');
    expect(job.residualNote).toContain('student_discipline_incidents.student_id');
  });
});

describe('PRC-H077 PgTenantWipeExecutor', () => {
  it('classifies tables from the explicit registry (unknown → unclassified)', () => {
    expect(classifyWipeTable('parent_fee_invoices')).toBe('fees');
    expect(classifyWipeTable('staff_payroll_runs')).toBe('payroll');
    expect(classifyWipeTable('health_allergies')).toBe('health');
    expect(classifyWipeTable('student_documents')).toBe('files_storage');
    expect(classifyWipeTable('students')).toBe('students');
    expect(classifyWipeTable('grade_change_audit')).toBe('audit_archives');
    expect(classifyWipeTable('fee_invoices')).toBe('unclassified');
  });

  it('wipes only registry `wipe` tables in FK-resolving passes', async () => {
    let studentsAttempts = 0;
    const { pool, queries } = fakePool((sql) => {
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            'students',
            'student_documents',
            'parent_fee_invoices',
            'health_allergies',
            'privacy_legal_holds',
            'staff',
          ].map((table_name) => ({ table_name })),
        };
      }
      if (sql.startsWith('DELETE FROM "students"')) {
        studentsAttempts += 1;
        if (studentsAttempts === 1) throw new Error('fk violation');
      }
      return { rows: [], rowCount: 1 };
    });
    const results = await new PgTenantWipeExecutor(pool as never, {
      objectStoreWiper: { async wipeTenant() {} },
    }).wipe({ tenantId: input.tenantId, jobId: 'j', reason: 'offboard' });
    const deletes = queries.filter((q) => q.sql.startsWith('DELETE')).map((q) => q.sql);
    expect(deletes.some((d) => /parent_fee|health|privacy_/.test(d))).toBe(false);
    expect(studentsAttempts).toBe(2);
    const byDomain = Object.fromEntries(results.map((r) => [r.domain, r.status]));
    expect(byDomain).toEqual({
      students: 'completed',
      staff: 'completed',
      files_storage: 'completed',
      fees: 'skipped',
      health: 'skipped',
      privacy_evidence: 'skipped',
      object_storage: 'completed',
    });
  });

  it('never deletes statutory finance/payroll/scholarship or audit tables the old regex missed', async () => {
    const statutory = [
      'staff_payroll_runs',
      'staff_payroll_lines',
      'staff_payroll_ledger_entries',
      'scholarship_disbursements',
      'scholarship_compliance_records',
      'hostel_fee_structures',
      'transport_fee_structures',
      'transport_fee_links',
      'grade_change_audit',
      'workflow_transition_audit',
      'enrollment_history',
      // FK parents whose deletion would cascade into the kept rows above.
      'scholarship_applications',
      'enrollments',
      'grade_entries',
      'workflow_instances',
      'hostels',
    ];
    const { pool, queries } = fakePool((sql) => {
      if (sql.includes('information_schema.columns')) {
        return { rows: [...statutory, 'lms_lessons'].map((table_name) => ({ table_name })) };
      }
      return { rows: [], rowCount: 1 };
    });
    const results = await new PgTenantWipeExecutor(pool as never, {
      objectStoreWiper: { async wipeTenant() {} },
    }).wipe({ tenantId: input.tenantId, jobId: 'j', reason: 'offboard' });
    const deletes = queries.filter((q) => q.sql.startsWith('DELETE')).map((q) => q.sql);
    expect(deletes).toEqual(['DELETE FROM "lms_lessons" WHERE tenant_id::text = $1']);
    const byDomain = new Map(results.map((r) => [r.domain, r]));
    expect(byDomain.get('payroll')?.status).toBe('skipped');
    expect(byDomain.get('payroll')?.note).toContain('staff_payroll_runs');
    expect(byDomain.get('fees')?.note).toContain('scholarship_disbursements');
    expect(byDomain.get('audit_archives')?.note).toContain('grade_change_audit');
    expect(byDomain.get('retained_dependencies')?.status).toBe('skipped');
    expect(byDomain.get('lms')?.status).toBe('completed');
  });

  it('keeps unclassified and manual tables and reports them as residual (deny by default)', async () => {
    const { pool, queries } = fakePool((sql) => {
      if (sql.includes('information_schema.columns')) {
        return {
          rows: ['brand_new_table', 'control_plane_documents', 'Weird-Name', 'staff'].map(
            (table_name) => ({ table_name }),
          ),
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const results = await new PgTenantWipeExecutor(pool as never, {
      objectStoreWiper: { async wipeTenant() {} },
    }).wipe({ tenantId: input.tenantId, jobId: 'j', reason: 'offboard' });
    const deletes = queries.filter((q) => q.sql.startsWith('DELETE')).map((q) => q.sql);
    expect(deletes).toEqual(['DELETE FROM "staff" WHERE tenant_id::text = $1']);
    const byDomain = new Map(results.map((r) => [r.domain, r]));
    expect(byDomain.get('unclassified')?.status).toBe('residual');
    expect(byDomain.get('unclassified')?.note).toContain('brand_new_table');
    expect(byDomain.get('unclassified')?.note).toContain('Weird-Name');
    expect(byDomain.get('control_plane_documents')?.status).toBe('residual');
  });

  it('a residual wipe result fails the offboard job closed end-to-end', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('information_schema.columns')) {
        return { rows: [{ table_name: 'brand_new_table' }, { table_name: 'staff' }] };
      }
      return { rows: [], rowCount: 1 };
    });
    const repository = new InMemoryPrivacyRepository();
    const service = new PrivacyService(repository, {
      tenantWipeExecutor: new PgTenantWipeExecutor(pool as never, {
        objectStoreWiper: { async wipeTenant() {} },
      }),
    });
    // No offboard publisher → the wipe runs inline and returns the final job.
    const done = await service.requestTenantOffboardWipe({
      tenantId: input.tenantId,
      requestedBy: 'platform-admin',
      reason: 'contract ended',
    });
    expect(done.status).toBe('failed');
    expect(done.completedAt).not.toBeNull();
    expect(done.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'unclassified', status: 'residual' }),
      ]),
    );
  });

  it('reports residual when a table cannot be deleted or objects are not wiped', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('information_schema.columns')) return { rows: [{ table_name: 'staff' }] };
      if (sql.startsWith('DELETE')) throw new Error('permission denied');
      return { rows: [] };
    });
    const results = await new PgTenantWipeExecutor(pool as never).wipe({
      tenantId: input.tenantId,
      jobId: 'j',
      reason: 'offboard',
    });
    const byDomain = Object.fromEntries(results.map((r) => [r.domain, r.status]));
    expect(byDomain).toMatchObject({ staff: 'residual', object_storage: 'residual' });
  });
});
