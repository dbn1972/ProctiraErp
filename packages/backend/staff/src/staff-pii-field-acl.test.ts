/**
 * PRC-M378: field-level masking on staff reads by permission.
 * - GET /staff, /staff/:id: date of birth and phone hidden like the identity number
 *   for roles without staff.update (finance roles).
 * - contracts: salary band only for HR officers / admins and payroll roles.
 * - leaves: free-text reason only for HR writers.
 * - appraisals: score and overall comments only for appraisal deciders.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerAppraisalRoutes } from './appraisal-routes.js';
import { AppraisalService } from './appraisal-service.js';
import { registerStaffHrRoutes } from './hr-routes.js';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import {
  InMemoryAppraisalRepository,
  InMemoryAppraisalTemplateRepository,
} from './in-memory-appraisal-repository.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';
import { registerStaffRoutes } from './routes.js';
import { StaffService } from './staff-service.js';

const TENANT = randomUUID();
const APPRAISAL = randomUUID();

describe('PRC-M378 staff PII field-level masking', () => {
  let app: FastifyInstance;
  let roles: string[];
  let staffId: string;

  beforeEach(async () => {
    roles = ['hr_officer'];
    const staffService = new StaffService(new InMemoryStaffRepository());
    const leaveRepo = new InMemoryStaffLeaveRepository();
    const appraisalRepo = new InMemoryAppraisalRepository();
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      Object.assign(request, { tenantId: TENANT, user: { sub: 'actor-1', roles } });
    });
    await registerStaffRoutes(app, { staffService });
    await registerStaffHrRoutes(app, {
      hrService: new StaffHrService(new InMemoryStaffHrStore(), staffService),
      staffService,
    });
    await registerStaffLeaveRoutes(app, {
      leaveService: new StaffLeaveService(leaveRepo),
      staffService,
    });
    await registerAppraisalRoutes(app, {
      appraisalService: new AppraisalService(
        new InMemoryAppraisalTemplateRepository(),
        appraisalRepo,
      ),
    });
    await app.ready();

    const staff = await staffService.create(TENANT, {
      firstName: 'Meera',
      lastName: 'Rao',
      dateOfBirth: '1986-02-11',
      identityNumber: 'AAD-4821-9937-6605',
      contactPhone: '+919876543210',
      position: 'Teacher',
    });
    staffId = staff.id;
    await leaveRepo.setBalance(TENANT, staffId, 'sick', 10);
    const contract = await app.inject({
      method: 'POST',
      url: '/staff/contracts',
      payload: { staffId, contractType: 'permanent', startDate: '2026-04-01', salaryBand: 'L4' },
    });
    expect(contract.statusCode).toBe(201);
    const leave = await app.inject({
      method: 'POST',
      url: '/staff/leaves',
      payload: {
        staffId,
        leaveType: 'sick',
        startDate: '2026-09-10',
        endDate: '2026-09-10',
        reason: 'Chemotherapy session',
      },
    });
    expect(leave.statusCode).toBe(201);
    await appraisalRepo.create({
      id: APPRAISAL,
      tenantId: TENANT,
      staffId,
      templateId: randomUUID(),
      appraisalDate: '2026-03-01',
      scores: [{ criterionName: 'Teaching', score: 2, comment: 'Struggles after illness' }],
      totalScore: 2,
      overallComment: 'Performance improvement plan',
      status: 'DRAFT',
      workflowInstanceId: null,
    });
  });

  const read = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('finance role: DOB, phone, salary band, leave reason and appraisal comments are masked', async () => {
    roles = ['bursar'];
    const list = (await read('/staff')).data[0];
    expect(list.dateOfBirth).toBeNull();
    expect(list.contactPhone).toBe('*********3210');
    const one = await read(`/staff/${staffId}`);
    expect(one.dateOfBirth).toBeNull();
    expect(one.contactPhone).not.toContain('98765');
    // payroll role keeps the salary band
    expect((await read('/staff/contracts')).data[0].salaryBand).toBe('L4');
    expect((await read('/staff/leaves')).data[0].reason).toBeNull();
    const appraisal = (await read('/staff/appraisals')).data[0];
    expect(appraisal.overallComment).toBeNull();
    expect(appraisal.scores).toEqual([{ criterionName: 'Teaching', score: 2, comment: null }]);
    expect((await read(`/staff/appraisals/${APPRAISAL}`)).overallComment).toBeNull();
  });

  it('registrar: sees contact details and leave reason, not salary band or appraisal comments', async () => {
    roles = ['registrar'];
    const one = await read(`/staff/${staffId}`);
    expect(one.dateOfBirth).toBe('1986-02-11');
    expect(one.contactPhone).toBe('+919876543210');
    expect((await read('/staff/contracts')).data[0].salaryBand).toBeNull();
    expect((await read('/staff/leaves')).data[0].reason).toBe('Chemotherapy session');
    expect((await read(`/staff/appraisals/${APPRAISAL}`)).overallComment).toBeNull();
  });

  it('HR officer sees every field', async () => {
    const one = await read(`/staff/${staffId}`);
    expect(one.dateOfBirth).toBe('1986-02-11');
    expect(one.contactPhone).toBe('+919876543210');
    expect((await read('/staff/contracts')).data[0].salaryBand).toBe('L4');
    expect((await read('/staff/leaves')).data[0].reason).toBe('Chemotherapy session');
    const appraisal = await read(`/staff/appraisals/${APPRAISAL}`);
    expect(appraisal.overallComment).toBe('Performance improvement plan');
    expect(appraisal.scores[0].comment).toBe('Struggles after illness');
  });
});
