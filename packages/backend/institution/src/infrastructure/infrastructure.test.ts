/**
 * Unit tests for Infrastructure Hierarchy Service and Routes.
 *
 * Tests CRUD operations for land, buildings, floors, and rooms
 * in parent-child hierarchy with capacity and condition validation.
 *
 * @requirements 5.6
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { InfrastructureService } from './service.js';
import { InMemoryInfrastructureStore, InMemoryConditionOptionStore } from './in-memory-store.js';
import { registerInfrastructureRoutes } from './routes.js';

describe('InfrastructureService', () => {
  let service: InfrastructureService;
  let store: InMemoryInfrastructureStore;
  let conditionStore: InMemoryConditionOptionStore;

  const institutionId = '12345678-1234-4234-8234-123456789abc';
  const tenantId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    store = new InMemoryInfrastructureStore();
    conditionStore = new InMemoryConditionOptionStore();
    service = new InfrastructureService({ store, conditionStore });
  });

  describe('Condition Options', () => {
    it('should add a condition option', async () => {
      const option = await service.addConditionOption(tenantId, 'Good', 'In good condition');
      expect(option.name).toBe('Good');
      expect(option.description).toBe('In good condition');
      expect(option.id).toBeDefined();
    });

    it('should reject duplicate condition option names', async () => {
      await service.addConditionOption(tenantId, 'Good');
      await expect(service.addConditionOption(tenantId, 'Good')).rejects.toThrow(
        "Condition option 'Good' already exists",
      );
    });

    it('should list all condition options', async () => {
      await service.addConditionOption(tenantId, 'Good');
      await service.addConditionOption(tenantId, 'Fair');
      const options = await service.listConditionOptions(tenantId);
      expect(options).toHaveLength(2);
    });
  });

  describe('Land CRUD', () => {
    it('should create a land record', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Main Campus',
        institutionId,
        capacity: 5000,
        condition: 'Good',
      });

      expect(land.id).toBeDefined();
      expect(land.name).toBe('Main Campus');
      expect(land.type).toBe('LAND');
      expect(land.institutionId).toBe(institutionId);
      expect(land.parentId).toBeNull();
      expect(land.capacity).toBe(5000);
      expect(land.condition).toBe('Good');
    });

    it('should reject invalid condition when options are configured', async () => {
      await service.addConditionOption(tenantId, 'Good');
      await service.addConditionOption(tenantId, 'Fair');

      await expect(
        service.createLand(tenantId, {
          name: 'Test Land',
          institutionId,
          capacity: 100,
          condition: 'Excellent',
        }),
      ).rejects.toThrow('Invalid condition');
    });

    it('should allow any condition when no options are configured', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Test Land',
        institutionId,
        capacity: 100,
        condition: 'AnyValue',
      });
      expect(land.condition).toBe('AnyValue');
    });

    it('should list lands for an institution', async () => {
      await service.createLand(tenantId, { name: 'Land A', institutionId, capacity: 100, condition: 'Good' });
      await service.createLand(tenantId, { name: 'Land B', institutionId, capacity: 200, condition: 'Fair' });

      const result = await service.listLands(tenantId, institutionId, {
        page: 1, pageSize: 20, sortBy: 'name', sortOrder: 'asc',
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });
  });

  describe('Building CRUD (child of Land)', () => {
    let landId: string;

    beforeEach(async () => {
      const land = await service.createLand(tenantId, {
        name: 'Main Campus',
        institutionId,
        capacity: 5000,
        condition: 'Good',
      });
      landId = land.id;
    });

    it('should create a building under a land', async () => {
      const building = await service.createBuilding(tenantId, {
        name: 'Science Block',
        institutionId,
        landId,
        capacity: 500,
        condition: 'Good',
      });

      expect(building.id).toBeDefined();
      expect(building.name).toBe('Science Block');
      expect(building.type).toBe('BUILDING');
      expect(building.parentId).toBe(landId);
      expect(building.capacity).toBe(500);
    });

    it('should reject building with non-existent parent land', async () => {
      await expect(
        service.createBuilding(tenantId, {
          name: 'Orphan Building',
          institutionId,
          landId: '00000000-0000-4000-8000-000000000000',
          capacity: 100,
          condition: 'Good',
        }),
      ).rejects.toThrow('Parent infrastructure item not found');
    });

    it('should reject building with wrong parent type', async () => {
      // Create a building, then try to create another building under it
      const building = await service.createBuilding(tenantId, {
        name: 'Building A',
        institutionId,
        landId,
        capacity: 100,
        condition: 'Good',
      });

      await expect(
        service.createBuilding(tenantId, {
          name: 'Building B',
          institutionId,
          landId: building.id, // This is a building, not a land
          capacity: 100,
          condition: 'Good',
        }),
      ).rejects.toThrow('Parent must be of type LAND');
    });

    it('should list buildings under a land', async () => {
      await service.createBuilding(tenantId, { name: 'B1', institutionId, landId, capacity: 100, condition: 'Good' });
      await service.createBuilding(tenantId, { name: 'B2', institutionId, landId, capacity: 200, condition: 'Fair' });

      const result = await service.listBuildings(tenantId, landId, {
        page: 1, pageSize: 20, sortBy: 'name', sortOrder: 'asc',
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });
  });

  describe('Floor CRUD (child of Building)', () => {
    let buildingId: string;

    beforeEach(async () => {
      const land = await service.createLand(tenantId, {
        name: 'Campus', institutionId, capacity: 5000, condition: 'Good',
      });
      const building = await service.createBuilding(tenantId, {
        name: 'Block A', institutionId, landId: land.id, capacity: 500, condition: 'Good',
      });
      buildingId = building.id;
    });

    it('should create a floor under a building', async () => {
      const floor = await service.createFloor(tenantId, {
        name: 'Ground Floor',
        institutionId,
        buildingId,
        capacity: 200,
        condition: 'Good',
      });

      expect(floor.type).toBe('FLOOR');
      expect(floor.parentId).toBe(buildingId);
      expect(floor.capacity).toBe(200);
    });

    it('should reject floor with non-building parent', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Another Land', institutionId, capacity: 100, condition: 'Good',
      });

      await expect(
        service.createFloor(tenantId, {
          name: 'Floor 1',
          institutionId,
          buildingId: land.id, // This is a land, not a building
          capacity: 100,
          condition: 'Good',
        }),
      ).rejects.toThrow('Parent must be of type BUILDING');
    });
  });

  describe('Room CRUD (child of Floor)', () => {
    let floorId: string;

    beforeEach(async () => {
      const land = await service.createLand(tenantId, {
        name: 'Campus', institutionId, capacity: 5000, condition: 'Good',
      });
      const building = await service.createBuilding(tenantId, {
        name: 'Block A', institutionId, landId: land.id, capacity: 500, condition: 'Good',
      });
      const floor = await service.createFloor(tenantId, {
        name: 'Floor 1', institutionId, buildingId: building.id, capacity: 200, condition: 'Good',
      });
      floorId = floor.id;
    });

    it('should create a room under a floor', async () => {
      const room = await service.createRoom(tenantId, {
        name: 'Room 101',
        institutionId,
        floorId,
        capacity: 40,
        condition: 'Good',
      });

      expect(room.type).toBe('ROOM');
      expect(room.parentId).toBe(floorId);
      expect(room.capacity).toBe(40);
    });

    it('should reject room with non-floor parent', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Land X', institutionId, capacity: 100, condition: 'Good',
      });

      await expect(
        service.createRoom(tenantId, {
          name: 'Room X',
          institutionId,
          floorId: land.id,
          capacity: 30,
          condition: 'Good',
        }),
      ).rejects.toThrow('Parent must be of type FLOOR');
    });
  });

  describe('Update and Delete', () => {
    it('should update an infrastructure item', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Old Name', institutionId, capacity: 100, condition: 'Good',
      });

      const updated = await service.update(tenantId, land.id, {
        name: 'New Name',
        capacity: 99999,
      });

      expect(updated.name).toBe('New Name');
      expect(updated.capacity).toBe(99999);
    });

    it('should reject update with invalid condition', async () => {
      await service.addConditionOption(tenantId, 'Good');
      await service.addConditionOption(tenantId, 'Fair');

      const land = await service.createLand(tenantId, {
        name: 'Land', institutionId, capacity: 100, condition: 'Good',
      });

      await expect(
        service.update(tenantId, land.id, { condition: 'Invalid' }),
      ).rejects.toThrow('Invalid condition');
    });

    it('should delete an item without children', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Empty Land', institutionId, capacity: 100, condition: 'Good',
      });

      await service.delete(tenantId, land.id);
      await expect(service.getById(tenantId, land.id)).rejects.toThrow('not found');
    });

    it('should reject deletion of item with children', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Land', institutionId, capacity: 100, condition: 'Good',
      });
      await service.createBuilding(tenantId, {
        name: 'Building', institutionId, landId: land.id, capacity: 50, condition: 'Good',
      });

      await expect(service.delete(tenantId, land.id)).rejects.toThrow('has child items');
    });

    it('should throw NotFoundError for non-existent item', async () => {
      await expect(
        service.getById(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow('not found');
    });
  });

  describe('Hierarchy Tree', () => {
    it('should return full hierarchy for an institution', async () => {
      const land = await service.createLand(tenantId, {
        name: 'Campus', institutionId, capacity: 5000, condition: 'Good',
      });
      const building = await service.createBuilding(tenantId, {
        name: 'Block A', institutionId, landId: land.id, capacity: 500, condition: 'Good',
      });
      const floor = await service.createFloor(tenantId, {
        name: 'Floor 1', institutionId, buildingId: building.id, capacity: 200, condition: 'Good',
      });
      await service.createRoom(tenantId, {
        name: 'Room 101', institutionId, floorId: floor.id, capacity: 40, condition: 'Good',
      });

      const hierarchy = await service.getHierarchy(tenantId, institutionId);

      expect(hierarchy.lands).toHaveLength(1);
      expect(hierarchy.lands[0].buildings).toHaveLength(1);
      expect(hierarchy.lands[0].buildings[0].floors).toHaveLength(1);
      expect(hierarchy.lands[0].buildings[0].floors[0].rooms).toHaveLength(1);
      expect(hierarchy.lands[0].buildings[0].floors[0].rooms[0].name).toBe('Room 101');
    });

    it('should return empty hierarchy for institution with no infrastructure', async () => {
      const hierarchy = await service.getHierarchy(tenantId, institutionId);
      expect(hierarchy.lands).toHaveLength(0);
    });
  });

  describe('Cross-institution isolation', () => {
    it('should reject building under land from different institution', async () => {
      const otherInstitutionId = '99999999-9999-4999-8999-999999999999';
      const land = await service.createLand(tenantId, {
        name: 'Land', institutionId, capacity: 100, condition: 'Good',
      });

      await expect(
        service.createBuilding(tenantId, {
          name: 'Building',
          institutionId: otherInstitutionId,
          landId: land.id,
          capacity: 50,
          condition: 'Good',
        }),
      ).rejects.toThrow('belongs to a different institution');
    });
  });
});

describe('Infrastructure Routes', () => {
  let app: FastifyInstance;
  let store: InMemoryInfrastructureStore;
  let conditionStore: InMemoryConditionOptionStore;

  const institutionId = '12345678-1234-4234-8234-123456789abc';
  const tenantId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    store = new InMemoryInfrastructureStore();
    conditionStore = new InMemoryConditionOptionStore();
    const service = new InfrastructureService({ store, conditionStore });

    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = tenantId;
    });
    await registerInfrastructureRoutes(app, { infrastructureService: service });
    await app.ready();
  });

  describe('POST /infrastructure/lands', () => {
    it('should create a land and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: {
          name: 'Main Campus',
          institutionId,
          capacity: 5000,
          condition: 'Good',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Main Campus');
      expect(body.type).toBe('LAND');
      expect(body.capacity).toBe(5000);
    });

    it('should return 400 for invalid capacity', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: {
          name: 'Land',
          institutionId,
          capacity: 0, // Below minimum of 1
          condition: 'Good',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for capacity exceeding 99999', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: {
          name: 'Land',
          institutionId,
          capacity: 100000, // Above maximum of 99999
          condition: 'Good',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: { name: 'Land' }, // Missing institutionId, capacity, condition
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /infrastructure/buildings', () => {
    it('should create a building under a land and return 201', async () => {
      // First create a land
      const landRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: { name: 'Campus', institutionId, capacity: 5000, condition: 'Good' },
      });
      const land = JSON.parse(landRes.body);

      const response = await app.inject({
        method: 'POST',
        url: '/infrastructure/buildings',
        payload: {
          name: 'Science Block',
          institutionId,
          landId: land.id,
          capacity: 500,
          condition: 'Good',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('BUILDING');
      expect(body.parentId).toBe(land.id);
    });

    it('should return 404 for non-existent parent land', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/infrastructure/buildings',
        payload: {
          name: 'Building',
          institutionId,
          landId: '00000000-0000-4000-8000-000000000000',
          capacity: 100,
          condition: 'Good',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /infrastructure/:id', () => {
    it('should update an infrastructure item', async () => {
      const landRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: { name: 'Old Name', institutionId, capacity: 100, condition: 'Good' },
      });
      const land = JSON.parse(landRes.body);

      const response = await app.inject({
        method: 'PUT',
        url: `/infrastructure/${land.id}`,
        payload: { name: 'New Name', capacity: 9999 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('New Name');
      expect(body.capacity).toBe(9999);
    });
  });

  describe('DELETE /infrastructure/:id', () => {
    it('should delete an item without children', async () => {
      const landRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: { name: 'Land', institutionId, capacity: 100, condition: 'Good' },
      });
      const land = JSON.parse(landRes.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/infrastructure/${land.id}`,
      });

      expect(response.statusCode).toBe(204);
    });

    it('should return 422 when deleting item with children', async () => {
      const landRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: { name: 'Land', institutionId, capacity: 100, condition: 'Good' },
      });
      const land = JSON.parse(landRes.body);

      await app.inject({
        method: 'POST',
        url: '/infrastructure/buildings',
        payload: { name: 'Building', institutionId, landId: land.id, capacity: 50, condition: 'Good' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/infrastructure/${land.id}`,
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('GET /infrastructure/hierarchy/:institutionId', () => {
    it('should return the full hierarchy tree', async () => {
      // Create full hierarchy
      const landRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/lands',
        payload: { name: 'Campus', institutionId, capacity: 5000, condition: 'Good' },
      });
      const land = JSON.parse(landRes.body);

      const buildingRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/buildings',
        payload: { name: 'Block A', institutionId, landId: land.id, capacity: 500, condition: 'Good' },
      });
      const building = JSON.parse(buildingRes.body);

      const floorRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/floors',
        payload: { name: 'Floor 1', institutionId, buildingId: building.id, capacity: 200, condition: 'Good' },
      });
      const floor = JSON.parse(floorRes.body);

      await app.inject({
        method: 'POST',
        url: '/infrastructure/rooms',
        payload: { name: 'Room 101', institutionId, floorId: floor.id, capacity: 40, condition: 'Good' },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/infrastructure/hierarchy/${institutionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.lands).toHaveLength(1);
      expect(body.lands[0].buildings).toHaveLength(1);
      expect(body.lands[0].buildings[0].floors).toHaveLength(1);
      expect(body.lands[0].buildings[0].floors[0].rooms).toHaveLength(1);
    });
  });

  describe('Condition Options Routes', () => {
    it('should create and list condition options', async () => {
      await app.inject({
        method: 'POST',
        url: '/infrastructure/condition-options',
        payload: { name: 'Good', description: 'In good condition' },
      });
      await app.inject({
        method: 'POST',
        url: '/infrastructure/condition-options',
        payload: { name: 'Fair' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/infrastructure/condition-options',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(2);
    });

    it('should delete a condition option', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/infrastructure/condition-options',
        payload: { name: 'Poor' },
      });
      const option = JSON.parse(createRes.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/infrastructure/condition-options/${option.id}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
