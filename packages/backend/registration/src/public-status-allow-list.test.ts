/**
 * PRC-L532: the anonymous status lookup (the web /track page calls
 * POST /registrations/status) returns only public-safe fields, even if the
 * service result carries more (staff actor, notes, remarks, contact details).
 */
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { RegistrationService } from './registration-service.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { registerRegistrationRoutes, toPublicRegistrationStatus } from './routes.js';

const TENANT = 'tenant-l532';
const PUBLIC_KEYS = [
  'applicantName',
  'institutionName',
  'interviewBookings',
  'status',
  'submittedAt',
  'trackingNumber',
  'updatedAt',
  'waitlistPosition',
];

function leakyStatus() {
  return {
    trackingNumber: 'REG-ABCD1234',
    status: 'under_review' as const,
    institutionName: 'Sunrise School',
    applicantName: 'A.',
    submittedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    waitlistPosition: 3,
    interviewBookings: [
      { id: 'b1', slotId: 's1', status: 'booked', interviewerNotes: 'calm child' },
    ],
    remarks: 'Father unemployed, fee waiver likely',
    reviewedBy: 'registrar@school.test',
    statusHistory: [{ actor: 'registrar@school.test', note: 'called guardian' }],
    guardianPhone: '+91 99999 00000',
  };
}

describe('PRC-L532 public status allow-list', () => {
  it('POST /registrations/status drops every non-public field', async () => {
    const service = new RegistrationService(new InMemoryRegistrationRepository());
    vi.spyOn(service, 'checkStatus').mockResolvedValue(leakyStatus() as never);
    const app = Fastify();
    await registerRegistrationRoutes(app, {
      registrationService: service,
      defaultTenantId: TENANT,
    });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/registrations/status',
      payload: { trackingNumber: 'REG-ABCD1234', dateOfBirth: '2012-01-01' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    expect(body['interviewBookings']).toEqual([{ id: 'b1', slotId: 's1', status: 'booked' }]);
    expect(res.body).not.toContain('registrar@school.test');
    expect(res.body).not.toContain('Father unemployed');
    expect(res.body).not.toContain('99999');
    await app.close();
  });

  it('omits optional fields that are absent', () => {
    const { waitlistPosition: _w, interviewBookings: _i, ...rest } = leakyStatus();
    expect(Object.keys(toPublicRegistrationStatus(rest as never)).sort()).toEqual([
      'applicantName',
      'institutionName',
      'status',
      'submittedAt',
      'trackingNumber',
      'updatedAt',
    ]);
  });
});
