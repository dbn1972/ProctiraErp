/**
 * Integration tests for Custom Field Routes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { CustomFieldService } from './custom-field-service.js';
import {
  InMemoryCustomFieldDefinitionRepository,
  InMemoryCustomFieldValueRepository,
} from './in-memory-repository.js';
import { registerCustomFieldRoutes } from './routes.js';

const TENANT_ID = 'tenant-1';

function buildApp(): FastifyInstance {
  const app = Fastify();

  // Simulate tenant resolution
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
  });

  return app;
}

describe('Custom Field Routes', () => {
  let app: FastifyInstance;
  let service: CustomFieldService;

  beforeEach(async () => {
    const definitionRepo = new InMemoryCustomFieldDefinitionRepository();
    const valueRepo = new InMemoryCustomFieldValueRepository();
    service = new CustomFieldService(definitionRepo, valueRepo);

    app = buildApp();
    await registerCustomFieldRoutes(app, { customFieldService: service });
    await app.ready();
  });

  describe('POST /custom-fields/definitions', () => {
    it('should create a custom field definition', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'blood_type',
          label: 'Blood Type',
          fieldType: 'text',
          validationRules: { maxLength: 5 },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.id).toBeDefined();
      expect(body.entityType).toBe('student');
      expect(body.fieldKey).toBe('blood_type');
      expect(body.fieldType).toBe('text');
      expect(body.isActive).toBe(true);
    });

    it('should return 400 for invalid field key format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'Invalid-Key',
          label: 'Invalid',
          fieldType: 'text',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate field key', async () => {
      const payload = {
        entityType: 'student',
        fieldKey: 'unique_field',
        label: 'Unique Field',
        fieldType: 'text',
      };

      await app.inject({ method: 'POST', url: '/custom-fields/definitions', payload });
      const response = await app.inject({ method: 'POST', url: '/custom-fields/definitions', payload });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /custom-fields/definitions', () => {
    it('should list definitions with pagination', async () => {
      await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'field_one',
          label: 'Field One',
          fieldType: 'text',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'field_two',
          label: 'Field Two',
          fieldType: 'number',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/custom-fields/definitions?entityType=student',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(2);
      expect(body.meta.totalItems).toBe(2);
    });
  });

  describe('GET /custom-fields/definitions/:id', () => {
    it('should return a definition by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'staff',
          fieldKey: 'certification',
          label: 'Certification',
          fieldType: 'text',
        },
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'GET',
        url: `/custom-fields/definitions/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(created.id);
      expect(body.fieldKey).toBe('certification');
    });

    it('should return 404 for non-existent definition', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/custom-fields/definitions/00000000-0000-4000-8000-000000000099',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /custom-fields/definitions/:id', () => {
    it('should update a definition', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'nickname',
          label: 'Nickname',
          fieldType: 'text',
        },
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'PUT',
        url: `/custom-fields/definitions/${created.id}`,
        payload: {
          label: 'Preferred Name',
          description: 'Name the student prefers',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.label).toBe('Preferred Name');
      expect(body.description).toBe('Name the student prefers');
    });
  });

  describe('DELETE /custom-fields/definitions/:id', () => {
    it('should deactivate a definition', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'to_delete',
          label: 'To Delete',
          fieldType: 'text',
        },
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'DELETE',
        url: `/custom-fields/definitions/${created.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's deactivated
      const getResponse = await app.inject({
        method: 'GET',
        url: `/custom-fields/definitions/${created.id}`,
      });
      const body = JSON.parse(getResponse.payload);
      expect(body.isActive).toBe(false);
    });
  });

  describe('PUT /custom-fields/values/:entityType/:entityId', () => {
    it('should bulk set values for an entity', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'blood_type',
          label: 'Blood Type',
          fieldType: 'text',
        },
      });
      const def = JSON.parse(createResponse.payload);

      const entityId = '00000000-0000-4000-8000-000000000010';
      const response = await app.inject({
        method: 'PUT',
        url: `/custom-fields/values/student/${entityId}`,
        payload: {
          values: { [def.id]: 'O+' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].value).toBe('O+');
    });

    it('should return 400 for invalid values', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'age',
          label: 'Age',
          fieldType: 'number',
        },
      });
      const def = JSON.parse(createResponse.payload);

      const entityId = '00000000-0000-4000-8000-000000000010';
      const response = await app.inject({
        method: 'PUT',
        url: `/custom-fields/values/student/${entityId}`,
        payload: {
          values: { [def.id]: 'not a number' },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /custom-fields/values/:entityType/:entityId', () => {
    it('should get all values for an entity', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'blood_type',
          label: 'Blood Type',
          fieldType: 'text',
        },
      });
      const def = JSON.parse(createResponse.payload);

      const entityId = '00000000-0000-4000-8000-000000000010';
      await app.inject({
        method: 'PUT',
        url: `/custom-fields/values/student/${entityId}`,
        payload: { values: { [def.id]: 'AB+' } },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/custom-fields/values/student/${entityId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].value).toBe('AB+');
    });
  });

  describe('DELETE /custom-fields/values/:entityType/:entityId', () => {
    it('should delete all values for an entity', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/custom-fields/definitions',
        payload: {
          entityType: 'student',
          fieldKey: 'blood_type',
          label: 'Blood Type',
          fieldType: 'text',
        },
      });
      const def = JSON.parse(createResponse.payload);

      const entityId = '00000000-0000-4000-8000-000000000010';
      await app.inject({
        method: 'PUT',
        url: `/custom-fields/values/student/${entityId}`,
        payload: { values: { [def.id]: 'B-' } },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/custom-fields/values/student/${entityId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.deletedCount).toBe(1);
    });
  });
});
