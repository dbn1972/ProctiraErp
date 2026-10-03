/**
 * PRC-L153: staff CSV import treats staff+contract as one unit per row; bulk staff attendance
 * verifies staff in one query and writes all marks in one atomic statement.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@proctira/database', async (orig) => ({
  ...(await orig<typeof import('@proctira/database')>()),
  createDatabaseSchemaReadinessCheck: () => async () => undefined,
}));

const { StaffHrService } = await import('./hr-service.js');
const { InMemoryStaffHrStore } = await import('./hr-store.js');
const { InMemoryStaffRepository } = await import('./in-memory-repository.js');
const { StaffService } = await import('./staff-service.js');
const { PgStaffHrStore } = await import('./pg-hr-ops-store.js');

const TENANT = randomUUID();
const HEADER =
  'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position,contactEmail,contractType,startDate,endDate,salaryBand';

function services() {
  const repo = new InMemoryStaffRepository();
  const staffService = new StaffService(repo);
  const store = new InMemoryStaffHrStore();
  const hr = new StaffHrService(store, staffService);
  return { repo, staffService, store, hr };
}

async function countStaff(staffService: InstanceType<typeof StaffService>) {
  return (await staffService.list(TENANT, {}, { page: 1, pageSize: 100 })).meta.totalItems;
}

describe('PRC-L153 import commit atomicity per row', () => {
  it('contract failure rolls back the staff row and does not report it as created', async () => {
    const { staffService, store, hr } = services();
    vi.spyOn(store, 'createContract').mockRejectedValueOnce(new Error('contract store down'));
    const csv = `${HEADER}\nGrace,Hopper,1906-12-09,EMP-1,+15551111,Teacher,,permanent,2026-04-01,,L5`;
    const res = await hr.commitImport(TENANT, { csv });
    expect(res.created).toBe(0);
    expect(res.staffIds).toEqual([]);
    expect(res.errors).toEqual([expect.objectContaining({ row: 2 })]);
    expect(await countStaff(staffService)).toBe(0);
    // The identity number is free again, so a corrected retry succeeds.
    const retry = await hr.commitImport(TENANT, { csv });
    expect(retry.created).toBe(1);
  });

  it('Prisma P2002 duplicate is attributed to identityNumber', async () => {
    const { staffService, hr } = services();
    vi.spyOn(staffService, 'create').mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const csv = `${HEADER}\nGrace,Hopper,1906-12-09,EMP-2,+15551111,Teacher,,,,,`;
    const res = await hr.commitImport(TENANT, { csv });
    expect(res.errors[0]).toMatchObject({ row: 2, field: 'identityNumber' });
  });

  it('allOrNothing rejects the whole file before any write when a row is invalid', async () => {
    const { staffService, hr } = services();
    const csv = `${HEADER}\nGrace,Hopper,1906-12-09,EMP-3,+15551111,Teacher,,,,,\n,Bad,2010-01-01,EMP-BAD,+1,Teacher`;
    await expect(hr.commitImport(TENANT, { csv, allOrNothing: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await countStaff(staffService)).toBe(0);
  });
});

describe('PRC-L153 bulk staff attendance', () => {
  async function hire(staffService: InstanceType<typeof StaffService>, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = await staffService.create(TENANT, {
        firstName: 'A',
        lastName: `L${i}`,
        dateOfBirth: '1990-01-01',
        identityNumber: `BULK-${i}-${randomUUID().slice(0, 6)}`,
        contactPhone: '+15550000',
        position: 'Teacher',
      });
      ids.push(s.id);
    }
    return ids;
  }

  it('500 marks: one staff existence query and one bulk upsert', async () => {
    const { repo, staffService, store, hr } = services();
    const ids = await hire(staffService, 500);
    const findIds = vi.spyOn(repo, 'findExistingIds');
    const findById = vi.spyOn(repo, 'findById');
    const bulk = vi.spyOn(store, 'upsertAttendanceBulk');
    const out = await hr.markAttendanceBulk(
      TENANT,
      {
        date: '2026-04-01',
        marks: ids.map((staffId) => ({ staffId, status: 'present' as const })),
      },
      'actor-1',
    );
    expect(out).toHaveLength(500);
    expect(findIds).toHaveBeenCalledTimes(1);
    expect(findById).not.toHaveBeenCalled();
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(bulk.mock.calls[0]![0]).toHaveLength(500);
  });

  it('an unknown or cross-tenant staff id rejects the whole batch with nothing written', async () => {
    const { staffService, store, hr } = services();
    const [known] = await hire(staffService, 1);
    const bulk = vi.spyOn(store, 'upsertAttendanceBulk');
    await expect(
      hr.markAttendanceBulk(
        TENANT,
        {
          date: '2026-04-01',
          marks: [
            { staffId: known!, status: 'present' as const },
            { staffId: randomUUID(), status: 'absent' as const },
          ],
        },
        null,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(bulk).not.toHaveBeenCalled();
    expect(await store.listAttendance(TENANT, {})).toHaveLength(0);
  });

  it('PG store writes 500 marks with a single INSERT inside one tenant transaction', async () => {
    const sqls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        sqls.push(sql);
        if (sql.startsWith('INSERT INTO staff_hr_attendance')) {
          const rows = [];
          for (let i = 0; i < (values?.length ?? 0); i += 9) {
            rows.push({
              id: values![i],
              tenant_id: values![i + 1],
              staff_id: values![i + 2],
              attendance_date: values![i + 3],
              status: values![i + 4],
              notes: values![i + 5],
              marked_by: values![i + 6],
              created_at: values![i + 7],
              updated_at: values![i + 8],
            });
          }
          return { rows };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { query: client.query, connect: vi.fn(async () => client) };
    const store = new PgStaffHrStore(pool as never);
    const now = new Date();
    const records = Array.from({ length: 500 }, () => ({
      id: randomUUID(),
      tenantId: TENANT,
      staffId: randomUUID(),
      date: '2026-04-01',
      status: 'present' as const,
      notes: null,
      markedBy: null,
      createdAt: now,
      updatedAt: now,
    }));
    const out = await store.upsertAttendanceBulk(records);
    expect(out).toHaveLength(500);
    const inserts = sqls.filter((s) => s.startsWith('INSERT INTO staff_hr_attendance'));
    expect(inserts).toHaveLength(1);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
});

describe('PRC-M123 staff attendance integrity', () => {
  async function hireOne(staffService: InstanceType<typeof StaffService>, i: number) {
    return (
      await staffService.create(TENANT, {
        firstName: 'M',
        lastName: `M${i}`,
        dateOfBirth: '1990-01-01',
        identityNumber: `M123-${i}-${randomUUID().slice(0, 6)}`,
        contactPhone: '+15550000',
        position: 'Teacher',
      })
    ).id;
  }

  it('re-saving an unchanged mark keeps the original markedBy; a changed one is re-attributed', async () => {
    const { staffService, store, hr } = services();
    const a = await hireOne(staffService, 1);
    const b = await hireOne(staffService, 2);
    const date = '2026-04-01';
    await hr.markAttendanceBulk(
      TENANT,
      {
        date,
        marks: [
          { staffId: a, status: 'present' },
          { staffId: b, status: 'present' },
        ],
      },
      'hr-1',
    );
    await hr.markAttendanceBulk(
      TENANT,
      {
        date,
        marks: [
          { staffId: a, status: 'present' },
          { staffId: b, status: 'absent' },
        ],
      },
      'hr-2',
    );
    const rows = await store.listAttendance(TENANT, { date });
    const by = Object.fromEntries(rows.map((r) => [r.staffId, r.markedBy]));
    expect(by[a]).toBe('hr-1');
    expect(by[b]).toBe('hr-2');
  });

  it('rejects a future date (400 ValidationError) and writes nothing', async () => {
    const { staffService, store, hr } = services();
    const a = await hireOne(staffService, 3);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await expect(
      hr.markAttendanceBulk(
        TENANT,
        { date: future, marks: [{ staffId: a, status: 'present' }] },
        'x',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      hr.markAttendance(TENANT, { staffId: a, date: future, status: 'present' }, 'x'),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await store.listAttendance(TENANT, {})).toHaveLength(0);
  });

  it('PG upsert only re-attributes marked_by when the status changes', async () => {
    const sqls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        sqls.push(sql);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { query: client.query, connect: vi.fn(async () => client) };
    const store = new PgStaffHrStore(pool as never);
    const now = new Date();
    await store.upsertAttendanceBulk([
      {
        id: randomUUID(),
        tenantId: TENANT,
        staffId: randomUUID(),
        date: '2026-04-01',
        status: 'present',
        notes: null,
        markedBy: 'hr-2',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const insert = sqls.find((s) => s.startsWith('INSERT INTO staff_hr_attendance'))!;
    expect(insert).toMatch(
      /marked_by = CASE WHEN staff_hr_attendance\.status IS DISTINCT FROM EXCLUDED\.status/,
    );
  });
});
