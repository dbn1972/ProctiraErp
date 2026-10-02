/**
 * PRC-L162: sibling link and consent append races surface as 409, never 500,
 * and consent appends are serialised per (tenant, student, kind).
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { ConflictError } from '@proctira/common';
import { InMemoryStudents360Store, PgStudents360Store } from './store.js';

const TENANT_ID = randomUUID();

function pool(handler: (text: string, values?: unknown[]) => unknown) {
  const texts: string[] = [];
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      texts.push(text);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('set_config')) return { rows: [] };
      return handler(text, values);
    }),
    release: vi.fn(),
  };
  return { texts, pool: { connect: vi.fn(async () => client), query: vi.fn() } };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

describe('PgStudents360Store races (PRC-L162)', () => {
  it('createSiblingPair maps a lost unique race (23505) to ConflictError', async () => {
    const { pool: p, texts } = pool((text) => {
      if (text.includes('INSERT INTO student_siblings')) throw uniqueViolation();
      return { rows: [] };
    });
    const store = new PgStudents360Store(p as never);
    const a = randomUUID();
    const b = randomUUID();
    const now = new Date();
    await expect(
      store.createSiblingPair(
        { id: randomUUID(), tenantId: TENANT_ID, studentId: a, siblingId: b, createdAt: now },
        { id: randomUUID(), tenantId: TENANT_ID, studentId: b, siblingId: a, createdAt: now },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(texts).toContain('ROLLBACK');
  });

  it('appendConsent takes an advisory xact lock before reading the open row FOR UPDATE', async () => {
    const studentId = randomUUID();
    const { pool: p, texts } = pool((text, values) => {
      if (text.includes('INSERT INTO student_consents')) {
        return {
          rows: [
            {
              id: values![0],
              tenant_id: values![1],
              student_id: values![2],
              kind: values![3],
              granted: values![4],
              actor_id: values![5],
              recorded_at: values![6],
              version: values![7],
              supersedes_id: values![8],
              valid_from: values![9],
              valid_to: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const store = new PgStudents360Store(p as never);
    const saved = await store.appendConsent({
      id: randomUUID(),
      tenantId: TENANT_ID,
      studentId,
      kind: 'photo',
      granted: true,
      actorId: null,
      recordedAt: new Date(),
      version: 1,
      supersedesId: null,
      validFrom: new Date(),
      validTo: null,
    } as never);
    expect(saved.version).toBe(1);
    const lockIdx = texts.findIndex((t) => t.includes('pg_advisory_xact_lock'));
    const selectIdx = texts.findIndex(
      (t) => t.includes('FROM student_consents') && t.includes('FOR UPDATE'),
    );
    expect(lockIdx).toBeGreaterThan(-1);
    expect(selectIdx).toBeGreaterThan(lockIdx);
  });

  it('appendConsent maps a unique violation to ConflictError (no 500)', async () => {
    const { pool: p } = pool((text) => {
      if (text.includes('INSERT INTO student_consents')) throw uniqueViolation();
      return { rows: [] };
    });
    const store = new PgStudents360Store(p as never);
    await expect(
      store.appendConsent({
        id: randomUUID(),
        tenantId: TENANT_ID,
        studentId: randomUUID(),
        kind: 'photo',
        granted: true,
        actorId: null,
        recordedAt: new Date(),
      } as never),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('InMemoryStudents360Store sibling duplicate', () => {
  it('rejects a duplicate pair with ConflictError', async () => {
    const store = new InMemoryStudents360Store();
    const a = randomUUID();
    const b = randomUUID();
    const pair = () =>
      store.createSiblingPair(
        {
          id: randomUUID(),
          tenantId: TENANT_ID,
          studentId: a,
          siblingId: b,
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          tenantId: TENANT_ID,
          studentId: b,
          siblingId: a,
          createdAt: new Date(),
        },
      );
    await pair();
    await expect(pair()).rejects.toBeInstanceOf(ConflictError);
  });
});
