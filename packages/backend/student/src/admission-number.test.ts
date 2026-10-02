/**
 * PRC-L365: duplicate admission numbers are 409 (never 500 / half-created),
 * the raw admission_number write is not swallowed, and updates merge customData.
 */
import { describe, it, expect, vi } from 'vitest';
import { ConflictError } from '@proctira/common';
import Fastify from 'fastify';
import { InMemoryStudentRepository } from './in-memory-repository.js';
import { StudentService } from './student-service.js';
import { registerStudentRoutes } from './routes.js';
import { PrismaStudentRepository } from './prisma-student-repository.js';
import { isUniqueViolation } from './admission-number.js';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const body = (admissionNo?: string) => ({
  firstName: 'A',
  lastName: 'B',
  dateOfBirth: '2010-05-05',
  gender: 'female',
  ...(admissionNo ? { customData: { admissionNo } } : {}),
});

async function buildApp() {
  const repository = new InMemoryStudentRepository();
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    (request as unknown as { user: { roles: string[] } }).user = { roles: ['registrar'] };
  });
  await registerStudentRoutes(app, { studentService: new StudentService(repository) });
  await app.ready();
  return { app, repository };
}

describe('admission number uniqueness and customData merge (PRC-L365)', () => {
  it('duplicate admissionNo -> 409 and no second student', async () => {
    const { app, repository } = await buildApp();
    const first = await app.inject({ method: 'POST', url: '/students', payload: body('ADM-1') });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: '/students', payload: body('ADM-1') });
    expect(dup.statusCode).toBe(409);
    const all = await repository.list(TENANT_ID, {}, { page: 1, pageSize: 50 });
    expect(all.data).toHaveLength(1);
    await app.close();
  });

  it('PUT with customData {x:1} keeps admissionNo', async () => {
    const { app } = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/students', payload: body('ADM-7') });
    const id = created.json().id as string;
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      payload: { customData: { x: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().customData).toMatchObject({ x: 1, admissionNo: 'ADM-7' });
    await app.close();
  });

  it('classifies Prisma P2002, P2010/23505 and pg 23505 as unique violations', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2010', meta: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2010', meta: { code: '42703' } })).toBe(false);
  });

  it('Prisma repo: raw admission_number unique failure -> ConflictError (not swallowed)', async () => {
    const tx = {
      $executeRaw: vi.fn(async () => {
        throw Object.assign(new Error('raw query failed'), {
          code: 'P2010',
          meta: { code: '23505' },
        });
      }),
      $executeRawUnsafe: vi.fn(async () => 0),
      student: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const repo = new PrismaStudentRepository(prisma as never);
    await expect(
      repo.create({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: TENANT_ID,
        firstName: 'A',
        lastName: 'B',
        dateOfBirth: '2010-05-05',
        gender: 'female',
        nationalId: null,
        nationality: null,
        contacts: [],
        guardians: [],
        identityDocuments: [],
        customData: { admissionNo: 'ADM-1' },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(tx.$executeRaw).toHaveBeenCalled();
  });
});
