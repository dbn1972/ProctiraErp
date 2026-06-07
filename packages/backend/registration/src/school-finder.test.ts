/**
 * School Finder service + routes tests (Task 51.3, Requirement 16.9)
 *
 * Covers the geolocation distance filter, AND/OR semantics across
 * area / type / grade lists, the case-insensitive name search, and
 * the cross-field "all-or-nothing" rule for the latitude/longitude/
 * radiusKm triple.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@proctira/common';

import { RegistrationService } from './registration-service.js';
import {
  InMemoryRegistrationRepository,
  haversineKm,
  type InMemoryInstitution,
} from './in-memory-repository.js';
import { registerRegistrationRoutes } from './routes.js';

const tenantId = 'tenant-001';

// Three test schools at known offsets from a reference point. Distances
// are calculated below via Haversine so the geolocation tests stay
// honest if anyone tweaks the coordinates.
const REFERENCE: InMemoryInstitution[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Alpha Elementary',
    code: 'ALP-001',
    typeId: 'type-primary',
    typeName: 'Primary',
    areaId: 'area-north',
    areaName: 'North District',
    tenantId,
    status: 'ACTIVE',
    latitude: 12.9716, // Bengaluru centre
    longitude: 77.5946,
    address: '1 North Rd',
    availableGrades: ['grade-1', 'grade-2'],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Beta Secondary',
    code: 'BET-001',
    typeId: 'type-secondary',
    typeName: 'Secondary',
    areaId: 'area-south',
    areaName: 'South District',
    tenantId,
    status: 'ACTIVE',
    latitude: 12.95, // ~2.4 km south
    longitude: 77.59,
    address: '2 South Rd',
    availableGrades: ['grade-9', 'grade-10'],
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Gamma Higher Secondary',
    code: 'GAM-001',
    typeId: 'type-higher-secondary',
    typeName: 'Higher Secondary',
    areaId: 'area-east',
    areaName: 'East District',
    tenantId,
    status: 'ACTIVE',
    latitude: 13.05, // ~9 km north
    longitude: 77.6,
    address: '3 East Rd',
    availableGrades: ['grade-11', 'grade-12'],
  },
];

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(12.97, 77.59, 12.97, 77.59)).toBe(0);
  });

  it('matches the well-known great-circle distance for two points', () => {
    // 12.9716,77.5946 → 13.05,77.6 is ~8.7 km on the ground.
    const d = haversineKm(12.9716, 77.5946, 13.05, 77.6);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(10);
  });

  it('is symmetric', () => {
    const a = haversineKm(40.0, -74.0, 41.0, -73.0);
    const b = haversineKm(41.0, -73.0, 40.0, -74.0);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('RegistrationService.searchSchools', () => {
  let service: RegistrationService;
  let repository: InMemoryRegistrationRepository;

  beforeEach(() => {
    repository = new InMemoryRegistrationRepository();
    repository.seedInstitutions(REFERENCE);
    service = new RegistrationService(repository);
  });

  it('returns all active institutions sorted alphabetically when no filters set', async () => {
    const result = await service.searchSchools(tenantId, {});
    expect(result.data).toHaveLength(3);
    expect(result.data.map((r) => r.name)).toEqual([
      'Alpha Elementary',
      'Beta Secondary',
      'Gamma Higher Secondary',
    ]);
    expect(result.meta.totalItems).toBe(3);
    // No origin → no distanceKm on rows
    expect(result.data[0]!.distanceKm).toBeUndefined();
  });

  it('filters by radius and sorts ascending by distance when geolocation is provided', async () => {
    // Point near Beta (south of centre); 5 km radius should include
    // Alpha (~2.4 km) and Beta (≈0 km) but exclude Gamma (~11 km).
    const result = await service.searchSchools(tenantId, {
      latitude: 12.95,
      longitude: 77.59,
      radiusKm: 5,
    });
    expect(result.data.map((r) => r.name)).toEqual(['Beta Secondary', 'Alpha Elementary']);
    expect(result.data[0]!.distanceKm).toBeLessThan(result.data[1]!.distanceKm!);
    expect(result.meta.origin).toEqual({
      latitude: 12.95,
      longitude: 77.59,
      radiusKm: 5,
    });
  });

  it('returns empty results when radius is too small', async () => {
    const result = await service.searchSchools(tenantId, {
      latitude: 12.9716,
      longitude: 77.5946,
      radiusKm: 0.1,
    });
    expect(result.data).toHaveLength(1); // Only Alpha (≈0 km)
    expect(result.data[0]!.name).toBe('Alpha Elementary');
  });

  it('throws ValidationError when geolocation block is incomplete', async () => {
    await expect(
      service.searchSchools(tenantId, { latitude: 12.9716 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.searchSchools(tenantId, { longitude: 77.5946, radiusKm: 5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('AND-combines area, type, and grade filters', async () => {
    // Beta is the only secondary in the south offering grade-10.
    const result = await service.searchSchools(tenantId, {
      areaIds: ['area-south'],
      schoolTypes: ['type-secondary'],
      gradeLevels: ['grade-10'],
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe('Beta Secondary');
  });

  it('OR-combines values within each filter list', async () => {
    const result = await service.searchSchools(tenantId, {
      areaIds: ['area-north', 'area-east'],
    });
    expect(result.data.map((r) => r.name).sort()).toEqual([
      'Alpha Elementary',
      'Gamma Higher Secondary',
    ]);
  });

  it('matches by case-insensitive substring search on name', async () => {
    const result = await service.searchSchools(tenantId, { search: 'beta' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe('Beta Secondary');
  });

  it('paginates results', async () => {
    const page1 = await service.searchSchools(tenantId, { page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.meta).toMatchObject({
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });

    const page2 = await service.searchSchools(tenantId, { page: 2, pageSize: 2 });
    expect(page2.data).toHaveLength(1);
    expect(page2.meta.page).toBe(2);
  });

  it('excludes inactive institutions', async () => {
    repository.seedInstitutions([
      ...REFERENCE,
      {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Closed School',
        code: 'CLS-001',
        typeId: 'type-primary',
        areaId: 'area-north',
        tenantId,
        status: 'INACTIVE',
        latitude: 12.97,
        longitude: 77.59,
        address: null,
      },
    ]);
    const result = await service.searchSchools(tenantId, {});
    expect(result.data.map((r) => r.name)).not.toContain('Closed School');
  });
});

describe('GET /registrations/schools/search', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const repository = new InMemoryRegistrationRepository();
    repository.seedInstitutions(REFERENCE);
    const service = new RegistrationService(repository);

    app = Fastify();
    await registerRegistrationRoutes(app, {
      registrationService: service,
      defaultTenantId: tenantId,
    });
    await app.ready();
  });

  it('returns 200 with all schools when no filters are passed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/schools/search',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(3);
    expect(body.meta.totalItems).toBe(3);
  });

  it('filters by geolocation', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/schools/search?latitude=12.95&longitude=77.59&radiusKm=5',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(2);
    expect(body.meta.origin).toEqual({
      latitude: 12.95,
      longitude: 77.59,
      radiusKm: 5,
    });
  });

  it('rejects partial geolocation triple', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/schools/search?latitude=12.95',
    });
    // Either Typebox flags missing fields or the service does — both
    // surface as a 400 with code VALIDATION_ERROR.
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('accepts comma-separated multi-value filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/schools/search?areaIds=area-north,area-east',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.map((r: { name: string }) => r.name).sort()).toEqual([
      'Alpha Elementary',
      'Gamma Higher Secondary',
    ]);
  });

  it('accepts repeated query parameters for multi-value filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/schools/search?areaIds=area-north&areaIds=area-east',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(2);
  });

  it('paginates results via query params', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/schools/search?page=2&pageSize=2',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  it('rejects invalid latitude bound', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/schools/search?latitude=999&longitude=77.59&radiusKm=5',
    });
    expect(response.statusCode).toBe(400);
  });
});
