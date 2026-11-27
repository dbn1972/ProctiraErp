/**
 * PRC-M452: transport fee bands. Amounts are integer minor units with an
 * ISO-4217 code (D1); a distance band cannot be inverted or overlap another
 * active band of the same route/stop scope.
 */
import { ConflictError, ValidationError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { CreateTransportFeeStructureSchema } from './schemas.js';
import { TransportService } from './transport-service.js';

const TENANT = uuidv4();
const ACTOR = uuidv4();

describe('PRC-M452 transport fee band validation', () => {
  let service: TransportService;
  let routeId: string;

  beforeEach(async () => {
    service = new TransportService(new InMemoryTransportRepository());
    const route = await service.createRoute(TENANT, {
      name: 'North Loop',
      startLocation: 'Depot',
      endLocation: 'School',
      operatingDays: ['monday'],
      departureTime: '07:30',
      distanceKm: 12,
    });
    routeId = route.id;
  });

  it.each([
    [{ amountCents: 1250.5 }, 'fractional minor units'],
    [{ amountCents: 1250, currency: 'inr' }, 'lower-case currency'],
    [{ amountCents: 1250, currency: 'RS1' }, 'non-ISO currency'],
  ])('schema rejects %o (%s)', (fields) => {
    const result = validate(CreateTransportFeeStructureSchema, { name: 'Band', ...fields });
    expect(result.success).toBe(false);
  });

  it('schema accepts integer minor units with an ISO code', () => {
    const result = validate(CreateTransportFeeStructureSchema, {
      name: 'Band',
      amountCents: 125000,
      currency: 'INR',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an inverted band (min > max) with a validation error', async () => {
    await expect(
      service.createTransportFeeStructure(
        TENANT,
        { name: 'Inverted', routeId, minDistanceKm: 10, maxDistanceKm: 5, amountCents: 1000 },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a band that overlaps an active band on the same route', async () => {
    await service.createTransportFeeStructure(
      TENANT,
      { name: '0-5 km', routeId, minDistanceKm: 0, maxDistanceKm: 5, amountCents: 1000 },
      ACTOR,
    );
    await expect(
      service.createTransportFeeStructure(
        TENANT,
        { name: '4-10 km', routeId, minDistanceKm: 4, maxDistanceKm: 10, amountCents: 2000 },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      service.createTransportFeeStructure(
        TENANT,
        { name: 'open-ended', routeId, amountCents: 3000 },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows adjacent non-overlapping bands and bands of another scope', async () => {
    await service.createTransportFeeStructure(
      TENANT,
      { name: '0-5 km', routeId, minDistanceKm: 0, maxDistanceKm: 5, amountCents: 1000 },
      ACTOR,
    );
    await expect(
      service.createTransportFeeStructure(
        TENANT,
        { name: '5.1-10 km', routeId, minDistanceKm: 5.1, maxDistanceKm: 10, amountCents: 2000 },
        ACTOR,
      ),
    ).resolves.toMatchObject({ name: '5.1-10 km' });
    await expect(
      service.createTransportFeeStructure(
        TENANT,
        { name: 'flat', minDistanceKm: 0, maxDistanceKm: 5, amountCents: 900 },
        ACTOR,
      ),
    ).resolves.toMatchObject({ name: 'flat', routeId: null });
  });
});
