/** PRC-M439: a Fees outage leaves a pending outbox row that a retry invoices exactly once. */
import { v4 as uuidv4 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { InMemoryTransportRepository } from './in-memory-repository.js';
import type { TransportFeesPort } from './fees-port.js';
import { TransportService } from './transport-service.js';

const TENANT = uuidv4();

function flakyFees() {
  const state = { failing: true, invoices: 0 };
  const port: TransportFeesPort = {
    createFeeStructure: async () => ({ id: uuidv4() }),
    createInvoice: async () => {
      if (state.failing) throw new Error('fees unavailable');
      state.invoices += 1;
      return { id: uuidv4() };
    },
  };
  return { state, port };
}

async function seedAssignment(service: TransportService) {
  const route = await service.createRoute(TENANT, {
    name: 'R-M439',
    startLocation: 'Depot',
    endLocation: 'School',
    operatingDays: ['monday'],
    departureTime: '07:30',
  });
  await service.createTransportFeeStructure(TENANT, {
    name: 'Flat',
    routeId: route.id,
    amountCents: 1000,
    currency: 'INR',
  });
  await service.createStudentAssignment(TENANT, {
    studentId: uuidv4(),
    routeId: route.id,
    startDate: '2026-06-01',
  });
}

describe('transport fee link outbox (PRC-M439)', () => {
  it('createInvoice rejects -> pending link; retry invoices exactly once', async () => {
    const repo = new InMemoryTransportRepository();
    const { state, port } = flakyFees();
    const service = new TransportService(repo, undefined, port);
    await seedAssignment(service);
    const [link] = await repo.listFeeLinks(TENANT);
    expect(link?.status).toBe('pending');
    expect(link?.reason).toBe('fees unavailable');
    expect(await service.countPendingFeeLinks(TENANT)).toBe(1);

    // Still failing: stays pending and the lease is released with the error.
    expect((await service.retryPendingFeeLinks(TENANT)).stillPending).toBe(1);
    expect((await repo.listFeeLinks(TENANT))[0]?.reason).toBe('fees unavailable');

    state.failing = false;
    const [a, b] = await Promise.all([
      service.retryPendingFeeLinks(TENANT),
      service.retryPendingFeeLinks(TENANT),
    ]);
    expect(a.invoiced + b.invoiced).toBe(1);
    expect(state.invoices).toBe(1);
    expect((await repo.listFeeLinks(TENANT))[0]?.status).toBe('invoiced');
    expect((await service.retryPendingFeeLinks(TENANT)).claimed).toBe(0);
    expect(state.invoices).toBe(1);
  });

  it('a live lease is not re-claimed', async () => {
    const repo = new InMemoryTransportRepository();
    const { port } = flakyFees();
    const service = new TransportService(repo, undefined, port);
    await seedAssignment(service);
    const later = new Date(Date.now() + 60_000);
    expect(await repo.claimPendingFeeLinks(TENANT, 't1', later, 10)).toHaveLength(1);
    expect(await repo.claimPendingFeeLinks(TENANT, 't2', later, 10)).toHaveLength(0);
  });
});
