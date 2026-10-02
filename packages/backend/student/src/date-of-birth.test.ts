/**
 * PRC-L159: strict date-of-birth validation on the API and bulk import.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { InMemoryStudentRepository } from './in-memory-repository.js';
import { StudentService } from './student-service.js';
import { registerStudentRoutes } from './routes.js';
import { dateOfBirthError, isStrictIsoDate } from './date-of-birth.js';
import { validateRow } from './import/row-validator.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function futureDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

describe('dateOfBirthError', () => {
  it('accepts a leap day and a normal date', () => {
    expect(dateOfBirthError('2012-02-29')).toBeNull();
    expect(dateOfBirthError('2005-03-15')).toBeNull();
  });
  it.each(['2010-02-30', '2010-13-01', '2010-13-45', '2026-02-31', '2011-02-29', '2010-1-01'])(
    'rejects impossible date %s',
    (v) => {
      expect(isStrictIsoDate(v)).toBe(false);
      expect(dateOfBirthError(v)).not.toBeNull();
    },
  );
  it('rejects future and pre-1900 dates', () => {
    expect(dateOfBirthError(futureDate())).toMatch(/future/);
    expect(dateOfBirthError('0001-01-01')).toMatch(/1900/);
    expect(dateOfBirthError('1899-12-31')).toMatch(/1900/);
  });
});

describe('student routes reject invalid dateOfBirth with 400', () => {
  let app: FastifyInstance;
  let service: StudentService;
  beforeEach(async () => {
    app = Fastify();
    service = new StudentService(new InMemoryStudentRepository());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles: ['registrar'] };
    });
    await registerStudentRoutes(app, { studentService: service });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const body = (dateOfBirth: string) => ({
    firstName: 'A',
    lastName: 'B',
    dateOfBirth,
    gender: 'male',
  });

  it.each(['2010-13-45', '2026-02-31', '2010-02-30', 'FUTURE', '0001-01-01'])(
    'POST %s -> 400',
    async (raw) => {
      const dob = raw === 'FUTURE' ? futureDate() : raw;
      const res = await app.inject({
        method: 'POST',
        url: '/students',
        payload: body(dob),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    },
  );

  it('POST leap day 2012-02-29 -> 201; PUT impossible date -> 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      payload: body('2012-02-29'),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${id}`,
      payload: { dateOfBirth: '2012-02-30' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('import row validator', () => {
  const row = (dateOfBirth: string) => ({
    rowNumber: 2,
    firstName: 'A',
    lastName: 'B',
    dateOfBirth,
  });
  it('rejects day overflow and future dates as row errors', () => {
    expect(validateRow(row('2010-02-30')).some((e) => e.field === 'date_of_birth')).toBe(true);
    expect(validateRow(row(futureDate())).some((e) => e.field === 'date_of_birth')).toBe(true);
    expect(validateRow(row('2012-02-29')).some((e) => e.field === 'date_of_birth')).toBe(false);
  });
});
