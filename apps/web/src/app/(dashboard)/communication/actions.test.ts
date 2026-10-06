/**
 * PRC-L235 — communication server actions: validation, GatewayError mapping,
 * revalidatePath, and the two-person emergency confirm bound to the session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  ackCircularOnBehalf: vi.fn(),
  confirmEmergencyBlast: vi.fn(),
  createCampaign: vi.fn(),
  createCircular: vi.fn(),
  createEmergencyBlast: vi.fn(),
  dispatchEmergencyBlast: vi.fn(),
  previewCampaignAudience: vi.fn(),
  retryDeliveryLog: vi.fn(),
  sendCampaign: vi.fn(),
  sendCircular: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ sub: 'session-user' }));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/api/communication', () => api);
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    accessToken: 't',
    refreshToken: null,
    isExpired: false,
    user: { sub: session.sub, tenantId: 'tenant-a', email: 'a@b.test', roles: [] },
  })),
}));

import { GatewayError } from '@/lib/api/gateway';
import {
  ackCircularAction,
  confirmEmergencyBlastAction,
  createCircularAction,
  createEmergencyBlastAction,
  dispatchEmergencyBlastAction,
  previewAudienceAction,
  retryDeliveryAction,
  sendCircularAction,
} from './actions';

// Entity ids are UUIDs: the actions reject anything else before the gateway (PRC-L033).
const B1 = '0f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a01';
const B2 = '0f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a02';
const C1 = '0f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a03';
const D1 = '0f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a04';
beforeEach(() => {
  vi.clearAllMocks();
  session.sub = 'session-user';
});

describe('emergency blast two-person control', () => {
  it('confirms as the session user, ignoring any client-supplied actor id', async () => {
    api.confirmEmergencyBlast.mockResolvedValue({ id: B1, status: 'pending_second' });
    const forged = 'someone-else' as unknown as never;
    // Older clients passed an actorId; it must not reach the gateway.
    await (confirmEmergencyBlastAction as (id: string, a?: string) => Promise<unknown>)(B1, forged);
    expect(api.confirmEmergencyBlast).toHaveBeenCalledWith(B1, 'session-user');
  });

  it('records createdBy from the session, not the client payload', async () => {
    api.createEmergencyBlast.mockResolvedValue({ id: B2 });
    await createEmergencyBlastAction({
      reason: 'Flood',
      channels: ['sms'],
      createdBy: 'forged-user',
    });
    expect(api.createEmergencyBlast).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'session-user' }),
    );
  });

  it('surfaces the gateway rejection of a second confirm by the same actor', async () => {
    api.confirmEmergencyBlast.mockRejectedValue(
      new GatewayError({
        status: 409,
        code: 'CONFLICT',
        message: 'A different actor must provide the second confirmation',
      }),
    );
    const result = await confirmEmergencyBlastAction(B1);
    expect(result).toEqual({
      status: 'error',
      message: 'A different actor must provide the second confirmation',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports confirmed vs awaiting-second states and revalidates', async () => {
    api.confirmEmergencyBlast.mockResolvedValue({ id: B1, status: 'confirmed' });
    const result = await confirmEmergencyBlastAction(B1);
    expect(result.status).toBe('success');
    expect(result.message).toMatch(/blast confirmed/);
    expect(revalidatePath).toHaveBeenCalledWith('/communication/emergency');
  });

  it('maps dispatch failures to an error state', async () => {
    api.dispatchEmergencyBlast.mockRejectedValue(new Error('boom'));
    expect(await dispatchEmergencyBlastAction(B1)).toEqual({ status: 'error', message: 'boom' });
  });
});

describe('circulars', () => {
  it('rejects invalid circular input without calling the gateway', async () => {
    const result = await createCircularAction({
      title: '',
      body: '',
      audienceType: 'all',
      requiresAck: false,
      channels: [],
    } as never);
    expect(result.status).toBe('error');
    expect(api.createCircular).not.toHaveBeenCalled();
  });

  it('requires recipients for acknowledgement circulars', async () => {
    const result = await createCircularAction({
      title: 'Exam notice',
      body: 'Body text for the notice',
      audienceType: 'all',
      requiresAck: true,
      channels: ['in_app'],
      recipientIds: [],
    } as never);
    expect(result.status).toBe('error');
    expect(api.createCircular).not.toHaveBeenCalled();
  });

  it('send revalidates circular, detail, and delivery paths', async () => {
    api.sendCircular.mockResolvedValue({ id: C1, status: 'sent' });
    await sendCircularAction(C1);
    expect(revalidatePath).toHaveBeenCalledWith('/communication/circulars');
    expect(revalidatePath).toHaveBeenCalledWith(`/communication/circulars/${C1}`);
    expect(revalidatePath).toHaveBeenCalledWith('/communication/delivery');
  });

  it('ack rejects a blank recipient without calling the gateway', async () => {
    expect((await ackCircularAction(C1, '  ', 'Paper slip')).status).toBe('error');
    expect(api.ackCircularOnBehalf).not.toHaveBeenCalled();
  });
  it('ack rejects a missing or oversized reason without calling the gateway', async () => {
    expect(await ackCircularAction(C1, 'r1', '   ')).toEqual({
      status: 'error',
      message: 'A reason is required.',
    });
    expect((await ackCircularAction(C1, 'r1', 'x'.repeat(501))).status).toBe('error');
    expect(api.ackCircularOnBehalf).not.toHaveBeenCalled();
  });
  it('ack records on behalf with the trimmed recipient and reason', async () => {
    api.ackCircularOnBehalf.mockResolvedValue({ id: C1, ackRate: 0.5 });
    const res = await ackCircularAction(C1, ' r1 ', '  Paper slip returned ');
    expect(res.status).toBe('success');
    expect(api.ackCircularOnBehalf).toHaveBeenCalledWith(C1, 'r1', 'Paper slip returned');
  });
  it('ack maps a gateway 403 to its message', async () => {
    api.ackCircularOnBehalf.mockRejectedValue(
      new GatewayError({ status: 403, code: 'FORBIDDEN', message: 'Forbidden' }),
    );
    expect(await ackCircularAction(C1, 'r1', 'Paper slip')).toEqual({
      status: 'error',
      message: 'Forbidden',
    });
  });
});

describe('delivery retry', () => {
  it('revalidates the delivery log on success', async () => {
    api.retryDeliveryLog.mockResolvedValue({ id: D1, status: 'queued' });
    const result = await retryDeliveryAction(D1);
    expect(result).toMatchObject({ status: 'success', id: D1 });
    expect(revalidatePath).toHaveBeenCalledWith('/communication/delivery');
  });
});

describe('audience preview (PRC-M074)', () => {
  it('does not show a number when only the estimator is available', async () => {
    api.previewCampaignAudience.mockResolvedValue({
      estimatedRecipients: 100,
      scope: 'grade',
      breakdown: { base: 500 },
      honestyNote: 'estimator',
      source: 'estimator',
    });
    const result = await previewAudienceAction({ scope: 'grade', grade: '10' });
    expect(result.status).toBe('success');
    expect(result.message).toMatch(/estimate unavailable/i);
    expect(result.message).not.toMatch(/\d/);
    expect(result.estimatedRecipients).toBeUndefined();
  });

  it('shows the live count with its source', async () => {
    api.previewCampaignAudience.mockResolvedValue({
      estimatedRecipients: 42,
      scope: 'hostel',
      breakdown: {},
      honestyNote: 'live',
      source: 'live',
    });
    const result = await previewAudienceAction({ scope: 'hostel', hostelId: 'h' });
    expect(result.message).toBe('42 recipients (live count).');
    expect(result.estimatedRecipients).toBe(42);
  });
});
