/**
 * Integration tests for Registration Routes
 *
 * Tests the Fastify routes with in-memory repository.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { RegistrationService } from './registration-service.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { registerRegistrationRoutes } from './routes.js';

describe('Registration Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryRegistrationRepository;

  const testTenantId = 'tenant-001';
  const testInstitutionId = '12345678-1234-4123-8123-123456789abc';
  const testFormConfigurationId = '22345678-1234-4123-8123-123456789abc';

  beforeEach(async () => {
    repository = new InMemoryRegistrationRepository();
    const service = new RegistrationService(repository);

    // Seed test data
    repository.seedInstitutions([
      {
        id: testInstitutionId,
        name: 'Test School',
        code: 'TST-001',
        typeId: 'type-001',
        typeName: 'Primary',
        areaId: 'area-001',
        areaName: 'Test Area',
        tenantId: testTenantId,
        status: 'ACTIVE',
        latitude: 40.0,
        longitude: -74.0,
        address: '100 Test St',
        availableGrades: ['grade-1', 'grade-2'],
      },
    ]);
    repository.seedFormConfigurations([
      {
        id: testFormConfigurationId,
        tenantId: testTenantId,
        institutionId: testInstitutionId,
        version: 1,
        publishedAt: '2026-09-19T00:00:00.000Z',
        fields: [
          { id: 'photo', label: 'Photo', type: 'file', required: false },
          { id: 'other', label: 'Other', type: 'file', required: false },
        ],
      },
    ]);

    app = Fastify();
    await registerRegistrationRoutes(app, {
      registrationService: service,
      defaultTenantId: testTenantId,
    });
    await app.ready();
  });

  describe('POST /registrations', () => {
    const validBody = {
      institutionId: testInstitutionId,
      formConfigurationId: testFormConfigurationId,
      formConfigurationVersion: 1,
      firstName: 'Alice',
      lastName: 'Smith',
      dateOfBirth: '2012-03-15',
      gender: 'female',
      guardianName: 'Bob Smith',
      guardianPhone: '+1-555-0200',
    };

    it('should submit a registration and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/registrations',
        headers: { 'idempotency-key': 'submit-one' },
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
      expect(body.status).toBe('pending');
      expect(body.institutionId).toBe(testInstitutionId);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/registrations',
        payload: { institutionId: testInstitutionId },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent institution', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/registrations',
        headers: { 'idempotency-key': 'invalid-two' },
        payload: {
          ...validBody,
          institutionId: '99999999-9999-4999-9999-999999999999',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid document file type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/registrations',
        headers: { 'idempotency-key': 'invalid-two' },
        payload: {
          ...validBody,
          documents: [
            {
              fileName: 'virus.exe',
              fileType: 'application/x-executable',
              fileSize: 1024,
              documentType: 'other',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /registrations/:trackingNumber/status', () => {
    it('should return status for a valid tracking number', async () => {
      // First submit a registration
      const submitResponse = await app.inject({
        method: 'POST',
        url: '/registrations',
        headers: { 'idempotency-key': 'status-three' },
        payload: {
          institutionId: testInstitutionId,
          formConfigurationId: testFormConfigurationId,
          formConfigurationVersion: 1,
          firstName: 'Charlie',
          lastName: 'Brown',
          dateOfBirth: '2011-10-02',
          gender: 'male',
          guardianName: 'Parent Brown',
          guardianPhone: '+1-555-0300',
        },
      });

      const { trackingNumber } = JSON.parse(submitResponse.body);

      // Check status (DOB required to prevent tracking-number-only PII disclosure)
      const response = await app.inject({
        method: 'GET',
        url: `/registrations/${trackingNumber}/status?dob=2011-10-02`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.trackingNumber).toBe(trackingNumber);
      expect(body.status).toBe('pending');
      expect(body.applicantName).toBe('Charlie Brown');
      expect(body.institutionName).toBe('Test School');
    });

    it('should return 400 for invalid tracking number format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/INVALID-FORMAT/status',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent tracking number', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/REG-ZZZZZZZZ/status',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /registrations/institutions', () => {
    it('should return institution locations', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/institutions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Test School');
      expect(body.data[0].latitude).toBe(40.0);
      expect(body.data[0].longitude).toBe(-74.0);
      expect(body.meta.totalItems).toBe(1);
    });

    it('should filter by area', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/institutions?areaId=area-001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });

    it('should filter by type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/institutions?typeId=type-001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });

    it('should filter by grade', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/institutions?gradeId=grade-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });

    it('should return empty for non-matching filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/institutions?areaId=nonexistent',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('POST /registrations/language', () => {
    it('should set language preference and return session ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/registrations/language',
        payload: { language: 'ar' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.language).toBe('ar');
      expect(body.sessionId).toBeDefined();
      // W1-SEC-05: 128-bit CSPRNG session id (32 hex)
      expect(body.sessionId).toMatch(/^[0-9a-f]{32}$/);
      expect(response.headers['x-session-id']).toBe(body.sessionId);
    });

    it('mints sessions with randomBytes(16) and refuses client-chosen ids (W1-SEC-05)', () => {
      const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'routes.ts'), 'utf8');
      expect(src).toMatch(/randomBytes\s*\(\s*16\s*\)/);
      expect(src).toMatch(/NODE_ENV === 'production'/);
      expect(src).not.toMatch(/Math\.random\s*\(/);
    });

    it('rejects forged x-session-id that is not server-issued', async () => {
      const forged = 'a'.repeat(32);
      const response = await app.inject({
        method: 'GET',
        url: '/registrations/language',
        headers: { 'x-session-id': forged, 'user-agent': 'sec05-test' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sessionId).not.toBe(forged);
      expect(body.sessionId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should return 400 for invalid language code', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/registrations/language',
        payload: { language: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should persist language across requests with session', async () => {
      const headers = { 'user-agent': 'sec05-persist' };
      const setResponse = await app.inject({
        method: 'POST',
        url: '/registrations/language',
        headers,
        payload: { language: 'fr' },
      });

      const { sessionId } = JSON.parse(setResponse.body);
      expect(sessionId).toMatch(/^[0-9a-f]{32}$/);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/registrations/language',
        headers: { ...headers, 'x-session-id': sessionId },
      });

      expect(getResponse.statusCode).toBe(200);
      const body = JSON.parse(getResponse.body);
      expect(body.language).toBe('fr');
      expect(body.sessionId).toBe(sessionId);
    });

    it('does not reuse session when client binding mismatches', async () => {
      const setResponse = await app.inject({
        method: 'POST',
        url: '/registrations/language',
        headers: { 'user-agent': 'agent-a' },
        payload: { language: 'fr' },
      });
      const { sessionId } = JSON.parse(setResponse.body);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/registrations/language',
        headers: { 'user-agent': 'agent-b', 'x-session-id': sessionId },
      });
      const body = JSON.parse(getResponse.body);
      expect(body.sessionId).not.toBe(sessionId);
      expect(body.language).toBe('en');
    });
  });

  describe('GET /registrations/form-config/:institutionId', () => {
    it('should return form configuration for an institution', async () => {
      repository.seedFormConfigurations([
        {
          id: testFormConfigurationId,
          tenantId: testTenantId,
          institutionId: testInstitutionId,
          version: 2,
          publishedAt: '2026-09-19T00:00:00.000Z',
          fields: [{ id: 'field1', label: 'Test Field', type: 'text', required: true }],
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/registrations/form-config/${testInstitutionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(testFormConfigurationId);
      expect(body.institutionId).toBe(testInstitutionId);
      expect(body.version).toBe(2);
      expect(body.fields).toHaveLength(1);
      expect(body.fields[0].id).toBe('field1');
    });

    it('fails closed for an institution without a published config', async () => {
      repository.seedFormConfigurations([]);
      const response = await app.inject({
        method: 'GET',
        url: `/registrations/form-config/${testInstitutionId}`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('FORM_CONFIGURATION_NOT_FOUND');
    });
  });
});
