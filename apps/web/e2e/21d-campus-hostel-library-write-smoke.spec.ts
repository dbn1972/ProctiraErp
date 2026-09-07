/**
 * Hostel / Library / Transport — gated live write smoke + cross-tenant deny.
 * Uses HS256 Bearer JWTs (`createSignedJwt`) so api-gateway accepts writes.
 * Requires E2E_BACKEND_READY=1 and JWT_SECRET aligned with the gateway.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const HOSTEL_ID = 'b1000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const OVERDUE_LOAN_ID = 'd1000000-0000-4000-8000-000000000101';
const AVAILABLE_ITEM_ID = 'd1000000-0000-4000-8000-000000000001';

function gatewayAuthHeaders(sub: string, tenantId: string = TENANT_A): Record<string, string> {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant.test`,
    displayName: sub,
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

test.describe('Hostel / Library — live writes (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
  );

  test('hostel: create leave then approve', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/hostel/leaves`, {
      headers: gatewayAuthHeaders('warden-a'),
      data: {
        studentId: STUDENT_ID,
        hostelId: HOSTEL_ID,
        startDate: '2026-09-10',
        endDate: '2026-09-12',
        reason: `E2E leave ${Date.now()}`,
      },
    });
    const leave = await create.json();
    expect(create.status(), JSON.stringify(leave)).toBe(201);
    expect(leave.status).toBe('pending');

    const decide = await request.post(`${GATEWAY_URL}/api/v1/hostel/leaves/${leave.id}/decide`, {
      headers: gatewayAuthHeaders('warden-a'),
      data: { status: 'approved' },
    });
    const decided = await decide.json();
    expect(decide.status(), JSON.stringify(decided)).toBe(200);
    expect(decided.status).toBe('approved');
  });

  test('hostel: create visitor then check in', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/hostel/visitors`, {
      headers: gatewayAuthHeaders('warden-a'),
      data: {
        hostelId: HOSTEL_ID,
        visitorName: `E2E Visitor ${Date.now()}`,
        studentId: STUDENT_ID,
        visitDate: '2026-09-07',
      },
    });
    const visitor = await create.json();
    expect(create.status(), JSON.stringify(visitor)).toBe(201);
    expect(visitor.status).toBe('expected');

    const checkIn = await request.post(
      `${GATEWAY_URL}/api/v1/hostel/visitors/${visitor.id}/status`,
      {
        headers: gatewayAuthHeaders('warden-a'),
        data: { status: 'checked_in' },
      },
    );
    const updated = await checkIn.json();
    expect(checkIn.status(), JSON.stringify(updated)).toBe(200);
    expect(updated.status).toBe('checked_in');
  });

  test('library: renew overdue loan + clearance report', async ({ request }) => {
    const renew = await request.post(`${GATEWAY_URL}/api/v1/library/circulation/renew`, {
      headers: gatewayAuthHeaders('librarian-a'),
      data: { loanId: OVERDUE_LOAN_ID, extendDays: 7 },
    });
    const renewed = await renew.json();
    expect(renew.status(), JSON.stringify(renewed)).toBe(200);
    expect(renewed.status).toBe('checked_out');

    const clearance = await request.get(
      `${GATEWAY_URL}/api/v1/library/patrons/${STUDENT_ID}/clearance`,
      { headers: gatewayAuthHeaders('librarian-a') },
    );
    const report = await clearance.json();
    expect(clearance.status(), JSON.stringify(report)).toBe(200);
    expect(report.clear).toBe(false);
    expect(report.openLoanCount).toBeGreaterThanOrEqual(1);
  });

  test('library: checkout then return available item', async ({ request }) => {
    const checkout = await request.post(`${GATEWAY_URL}/api/v1/library/circulation/checkout`, {
      headers: gatewayAuthHeaders('librarian-a'),
      data: {
        itemId: AVAILABLE_ITEM_ID,
        studentId: STUDENT_ID,
      },
    });
    const loan = await checkout.json();
    expect(checkout.status(), JSON.stringify(loan)).toBe(201);
    expect(loan.status).toBe('checked_out');

    const ret = await request.post(`${GATEWAY_URL}/api/v1/library/circulation/return`, {
      headers: gatewayAuthHeaders('librarian-a'),
      data: { loanId: loan.id },
    });
    const returned = await ret.json();
    expect(ret.status(), JSON.stringify(returned)).toBe(200);
    expect(returned.status).toBe('returned');
  });

  test('cross-tenant deny: tenant B cannot decide tenant A leave', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/hostel/leaves`, {
      headers: gatewayAuthHeaders('warden-a', TENANT_A),
      data: {
        studentId: STUDENT_ID,
        hostelId: HOSTEL_ID,
        startDate: '2026-09-20',
        endDate: '2026-09-21',
        reason: `E2E cross-tenant ${Date.now()}`,
      },
    });
    expect(create.status()).toBe(201);
    const leave = await create.json();

    const cross = await request.post(`${GATEWAY_URL}/api/v1/hostel/leaves/${leave.id}/decide`, {
      headers: gatewayAuthHeaders('warden-b', TENANT_B),
      data: { status: 'approved' },
    });
    expect(cross.status()).toBe(404);
  });

  test('hostel: assign bed then 409 on double-book', async ({ request }) => {
    const bedId = 'b1000000-0000-4000-8000-000000000032';
    const first = await request.post(`${GATEWAY_URL}/api/v1/hostel/assignments`, {
      headers: gatewayAuthHeaders('warden-a'),
      data: {
        studentId: STUDENT_ID,
        bedId,
        startDate: '2026-09-08',
      },
    });
    const assignment = await first.json();
    // Bed may already be occupied from a prior run — accept 201 or 409.
    if (first.status() === 201) {
      expect(assignment.bedId).toBe(bedId);
    } else {
      expect(first.status(), JSON.stringify(assignment)).toBe(409);
    }

    const conflict = await request.post(`${GATEWAY_URL}/api/v1/hostel/assignments`, {
      headers: gatewayAuthHeaders('warden-a'),
      data: {
        studentId: '00000000-0000-4000-8000-000000000098',
        bedId,
        startDate: '2026-09-09',
      },
    });
    expect(conflict.status()).toBe(409);
  });
});

test.describe('Transport — live writes (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
  );

  test('creates a route and vehicle', async ({ request }) => {
    const routeRes = await request.post(`${GATEWAY_URL}/api/v1/transport/routes`, {
      headers: gatewayAuthHeaders('transport-a'),
      data: {
        name: `E2E Route ${Date.now()}`,
        startLocation: 'North Gate',
        endLocation: 'South Campus',
        operatingDays: ['monday', 'wednesday', 'friday'],
        departureTime: '07:30',
        returnTime: '15:30',
      },
    });
    const route = await routeRes.json();
    expect(routeRes.status(), JSON.stringify(route)).toBe(201);
    expect(route.status).toBe('active');

    const vehicleRes = await request.post(`${GATEWAY_URL}/api/v1/transport/vehicles`, {
      headers: gatewayAuthHeaders('transport-a'),
      data: {
        registrationNumber: `E2E-${Date.now()}`,
        make: 'Tata',
        model: 'Starbus',
        year: 2024,
        capacity: 40,
      },
    });
    const vehicle = await vehicleRes.json();
    expect(vehicleRes.status(), JSON.stringify(vehicle)).toBe(201);
    expect(vehicle.status).toBe('active');
  });

  test('cross-tenant deny: tenant B cannot read tenant A route', async ({ request }) => {
    const routeRes = await request.post(`${GATEWAY_URL}/api/v1/transport/routes`, {
      headers: gatewayAuthHeaders('transport-a', TENANT_A),
      data: {
        name: `E2E Isolation Route ${Date.now()}`,
        startLocation: 'A',
        endLocation: 'B',
        operatingDays: ['tuesday'],
      },
    });
    expect(routeRes.status()).toBe(201);
    const route = await routeRes.json();

    const cross = await request.get(`${GATEWAY_URL}/api/v1/transport/routes/${route.id}`, {
      headers: gatewayAuthHeaders('transport-b', TENANT_B),
    });
    expect(cross.status()).toBe(404);
  });
});
