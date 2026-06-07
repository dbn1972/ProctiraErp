/**
 * Transport Service Unit Tests
 *
 * Tests core business logic for transport route, vehicle,
 * driver assignment, and student assignment management.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TransportService } from './transport-service.js';
import { InMemoryTransportRepository } from './in-memory-repository.js';

describe('TransportService', () => {
  let service: TransportService;
  let repository: InMemoryTransportRepository;
  const tenantId = uuidv4();

  beforeEach(() => {
    repository = new InMemoryTransportRepository();
    service = new TransportService(repository);
  });

  // ─── Route Tests ─────────────────────────────────────────────────────

  describe('Routes', () => {
    it('should create a transport route', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route A',
        startLocation: 'School',
        endLocation: 'Town Center',
        operatingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        departureTime: '07:30',
        returnTime: '15:30',
      });

      expect(route.id).toBeDefined();
      expect(route.tenantId).toBe(tenantId);
      expect(route.name).toBe('Route A');
      expect(route.status).toBe('active');
      expect(route.operatingDays).toHaveLength(5);
    });

    it('should update a transport route', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route A',
        startLocation: 'School',
        endLocation: 'Town Center',
        operatingDays: ['monday', 'friday'],
      });

      const updated = await service.updateRoute(tenantId, route.id, {
        name: 'Route A - Updated',
        status: 'suspended',
      });

      expect(updated.name).toBe('Route A - Updated');
      expect(updated.status).toBe('suspended');
    });

    it('should throw NotFoundError when updating non-existent route', async () => {
      await expect(
        service.updateRoute(tenantId, uuidv4(), { name: 'X' }),
      ).rejects.toThrow('not found');
    });

    it('should get a route by ID', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route B',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      const found = await service.getRouteById(tenantId, route.id);
      expect(found.id).toBe(route.id);
    });

    it('should throw NotFoundError for non-existent route', async () => {
      await expect(
        service.getRouteById(tenantId, uuidv4()),
      ).rejects.toThrow('not found');
    });

    it('should delete a route without active assignments', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route C',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      await service.deleteRoute(tenantId, route.id);
      await expect(service.getRouteById(tenantId, route.id)).rejects.toThrow('not found');
    });

    it('should not delete a route with active student assignments', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route D',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      await service.createStudentAssignment(tenantId, {
        studentId: uuidv4(),
        routeId: route.id,
        startDate: '2024-01-01',
      });

      await expect(service.deleteRoute(tenantId, route.id)).rejects.toThrow(
        'active student assignments',
      );
    });
  });

  // ─── Stop Tests ──────────────────────────────────────────────────────

  describe('Stops', () => {
    it('should create a stop on an existing route', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route A',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      const stop = await service.createStop(tenantId, {
        routeId: route.id,
        name: 'Stop 1',
        stopOrder: 1,
        pickupTime: '07:45',
      });

      expect(stop.id).toBeDefined();
      expect(stop.routeId).toBe(route.id);
      expect(stop.name).toBe('Stop 1');
      expect(stop.stopOrder).toBe(1);
    });

    it('should throw NotFoundError when creating stop for non-existent route', async () => {
      await expect(
        service.createStop(tenantId, {
          routeId: uuidv4(),
          name: 'Stop X',
          stopOrder: 1,
        }),
      ).rejects.toThrow('not found');
    });

    it('should list stops ordered by stopOrder', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route A',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      await service.createStop(tenantId, { routeId: route.id, name: 'Stop 3', stopOrder: 3 });
      await service.createStop(tenantId, { routeId: route.id, name: 'Stop 1', stopOrder: 1 });
      await service.createStop(tenantId, { routeId: route.id, name: 'Stop 2', stopOrder: 2 });

      const stops = await service.listStopsByRoute(tenantId, route.id);
      expect(stops).toHaveLength(3);
      expect(stops[0].name).toBe('Stop 1');
      expect(stops[1].name).toBe('Stop 2');
      expect(stops[2].name).toBe('Stop 3');
    });

    it('should delete a stop', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route A',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      const stop = await service.createStop(tenantId, {
        routeId: route.id,
        name: 'Stop 1',
        stopOrder: 1,
      });

      await service.deleteStop(tenantId, stop.id);
      const stops = await service.listStopsByRoute(tenantId, route.id);
      expect(stops).toHaveLength(0);
    });
  });

  // ─── Vehicle Tests ───────────────────────────────────────────────────

  describe('Vehicles', () => {
    it('should create a vehicle', async () => {
      const vehicle = await service.createVehicle(tenantId, {
        registrationNumber: 'ABC-1234',
        make: 'Toyota',
        model: 'HiAce',
        year: 2022,
        capacity: 30,
      });

      expect(vehicle.id).toBeDefined();
      expect(vehicle.registrationNumber).toBe('ABC-1234');
      expect(vehicle.capacity).toBe(30);
      expect(vehicle.status).toBe('active');
    });

    it('should reject duplicate registration number', async () => {
      await service.createVehicle(tenantId, {
        registrationNumber: 'ABC-1234',
        capacity: 30,
      });

      await expect(
        service.createVehicle(tenantId, {
          registrationNumber: 'ABC-1234',
          capacity: 20,
        }),
      ).rejects.toThrow('already exists');
    });

    it('should update a vehicle', async () => {
      const vehicle = await service.createVehicle(tenantId, {
        registrationNumber: 'XYZ-5678',
        capacity: 40,
      });

      const updated = await service.updateVehicle(tenantId, vehicle.id, {
        status: 'maintenance',
        capacity: 45,
      });

      expect(updated.status).toBe('maintenance');
      expect(updated.capacity).toBe(45);
    });

    it('should reject duplicate registration on update', async () => {
      await service.createVehicle(tenantId, {
        registrationNumber: 'AAA-1111',
        capacity: 30,
      });

      const vehicle2 = await service.createVehicle(tenantId, {
        registrationNumber: 'BBB-2222',
        capacity: 30,
      });

      await expect(
        service.updateVehicle(tenantId, vehicle2.id, {
          registrationNumber: 'AAA-1111',
        }),
      ).rejects.toThrow('already exists');
    });

    it('should not delete a vehicle with active driver assignment', async () => {
      const vehicle = await service.createVehicle(tenantId, {
        registrationNumber: 'DEL-0001',
        capacity: 20,
      });

      await service.createDriverAssignment(tenantId, {
        vehicleId: vehicle.id,
        driverId: uuidv4(),
        startDate: '2024-01-01',
      });

      await expect(service.deleteVehicle(tenantId, vehicle.id)).rejects.toThrow(
        'active driver assignment',
      );
    });
  });

  // ─── Driver Assignment Tests ─────────────────────────────────────────

  describe('Driver Assignments', () => {
    it('should create a driver assignment', async () => {
      const vehicle = await service.createVehicle(tenantId, {
        registrationNumber: 'DRV-001',
        capacity: 30,
      });

      const assignment = await service.createDriverAssignment(tenantId, {
        vehicleId: vehicle.id,
        driverId: uuidv4(),
        startDate: '2024-01-01',
      });

      expect(assignment.id).toBeDefined();
      expect(assignment.vehicleId).toBe(vehicle.id);
      expect(assignment.isActive).toBe(true);
    });

    it('should reject assignment to non-existent vehicle', async () => {
      await expect(
        service.createDriverAssignment(tenantId, {
          vehicleId: uuidv4(),
          driverId: uuidv4(),
          startDate: '2024-01-01',
        }),
      ).rejects.toThrow('not found');
    });

    it('should reject assignment to inactive vehicle', async () => {
      const vehicle = await service.createVehicle(tenantId, {
        registrationNumber: 'INACT-001',
        capacity: 30,
      });
      await service.updateVehicle(tenantId, vehicle.id, { status: 'maintenance' });

      await expect(
        service.createDriverAssignment(tenantId, {
          vehicleId: vehicle.id,
          driverId: uuidv4(),
          startDate: '2024-01-01',
        }),
      ).rejects.toThrow('not active');
    });

    it('should reject duplicate active assignment on same vehicle', async () => {
      const vehicle = await service.createVehicle(tenantId, {
        registrationNumber: 'DUP-001',
        capacity: 30,
      });

      await service.createDriverAssignment(tenantId, {
        vehicleId: vehicle.id,
        driverId: uuidv4(),
        startDate: '2024-01-01',
      });

      await expect(
        service.createDriverAssignment(tenantId, {
          vehicleId: vehicle.id,
          driverId: uuidv4(),
          startDate: '2024-02-01',
        }),
      ).rejects.toThrow('already has an active driver assignment');
    });

    it('should update a driver assignment', async () => {
      const vehicle = await service.createVehicle(tenantId, {
        registrationNumber: 'UPD-001',
        capacity: 30,
      });

      const assignment = await service.createDriverAssignment(tenantId, {
        vehicleId: vehicle.id,
        driverId: uuidv4(),
        startDate: '2024-01-01',
      });

      const updated = await service.updateDriverAssignment(tenantId, assignment.id, {
        isActive: false,
        endDate: '2024-06-30',
      });

      expect(updated.isActive).toBe(false);
      expect(updated.endDate).toBe('2024-06-30');
    });
  });

  // ─── Student Assignment Tests ────────────────────────────────────────

  describe('Student Assignments', () => {
    it('should assign a student to a route', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route S',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      const assignment = await service.createStudentAssignment(tenantId, {
        studentId: uuidv4(),
        routeId: route.id,
        startDate: '2024-01-15',
      });

      expect(assignment.id).toBeDefined();
      expect(assignment.routeId).toBe(route.id);
      expect(assignment.isActive).toBe(true);
    });

    it('should reject assignment to non-existent route', async () => {
      await expect(
        service.createStudentAssignment(tenantId, {
          studentId: uuidv4(),
          routeId: uuidv4(),
          startDate: '2024-01-15',
        }),
      ).rejects.toThrow('not found');
    });

    it('should reject assignment to inactive route', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route Inactive',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });
      await service.updateRoute(tenantId, route.id, { status: 'inactive' });

      await expect(
        service.createStudentAssignment(tenantId, {
          studentId: uuidv4(),
          routeId: route.id,
          startDate: '2024-01-15',
        }),
      ).rejects.toThrow('inactive');
    });

    it('should reject duplicate active assignment for same student', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route Dup',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      const studentId = uuidv4();
      await service.createStudentAssignment(tenantId, {
        studentId,
        routeId: route.id,
        startDate: '2024-01-15',
      });

      await expect(
        service.createStudentAssignment(tenantId, {
          studentId,
          routeId: route.id,
          startDate: '2024-02-01',
        }),
      ).rejects.toThrow('already has an active');
    });

    it('should validate stop belongs to route', async () => {
      const route1 = await service.createRoute(tenantId, {
        name: 'Route 1',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });
      const route2 = await service.createRoute(tenantId, {
        name: 'Route 2',
        startLocation: 'C',
        endLocation: 'D',
        operatingDays: ['tuesday'],
      });

      const stop = await service.createStop(tenantId, {
        routeId: route2.id,
        name: 'Stop on Route 2',
        stopOrder: 1,
      });

      await expect(
        service.createStudentAssignment(tenantId, {
          studentId: uuidv4(),
          routeId: route1.id,
          stopId: stop.id,
          startDate: '2024-01-15',
        }),
      ).rejects.toThrow('does not belong');
    });

    it('should update a student assignment', async () => {
      const route = await service.createRoute(tenantId, {
        name: 'Route U',
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['monday'],
      });

      const assignment = await service.createStudentAssignment(tenantId, {
        studentId: uuidv4(),
        routeId: route.id,
        startDate: '2024-01-15',
      });

      const updated = await service.updateStudentAssignment(tenantId, assignment.id, {
        isActive: false,
        endDate: '2024-06-30',
      });

      expect(updated.isActive).toBe(false);
      expect(updated.endDate).toBe('2024-06-30');
    });
  });
});
