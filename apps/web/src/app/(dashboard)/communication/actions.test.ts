/**
 * PRC-L235 — communication server actions: validation, GatewayError mapping,
 * revalidatePath, and the two-person emergency confirm bound to the session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  ackCircular: vi.fn(),
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
  retryDeliveryAction,
  sendCircularAction,
} from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  session.sub = 'session-user';
});

describe('emergency blast two-person control', () => {
  it('confirms as the session user, ignoring any client-supplied actor id', async () => {
    api.confirmEmergencyBlast.mockResolvedValue({ id: 'b1', status: 'pending_second' });
    const forged = 'someone-else' as unknown as never;
    // Older clients passed an actorId; it must not reach the gateway.
    await (confirmEmergencyBlastAction as (id: string, a?: string) => Promise<unknown>)(
      'b1',
      forged,
    );
    expect(api.confirmEmergencyBlast).toHaveBeenCalledWith('b1', 'session-user');
  });

  it('records createdBy from the session, not the client payload', async () => {
    api.createEmergencyBlast.mockResolvedValue({ id: 'b2' });
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
    const result = await confirmEmergencyBlastAction('b1');
    expect(result).toEqual({
      status: 'error',
      message: 'A different actor must provide the second confirmation',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports confirmed vs awaiting-second states and revalidates', async () => {
    api.confirmEmergencyBlast.mockResolvedValue({ id: 'b1', status: 'confirmed' });
    const result = await confirmEmergencyBlastAction('b1');
    expect(result.status).toBe('success');
    expect(result.message).toMatch(/blast confirmed/);
    expect(revalidatePath).toHaveBeenCalledWith('/communication/emergency');
  });

  it('maps dispatch failures to an error state', async () => {
    api.dispatchEmergencyBlast.mockRejectedValue(new Error('boom'));
    expect(await dispatchEmergencyBlastAction('b1')).toEqual({ status: 'error', message: 'boom' });
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
    api.sendCircular.mockResolvedValue({ id: 'c1', status: 'sent' });
    await sendCircularAction('c1');
    expect(revalidatePath).toHaveBeenCalledWith('/communication/circulars');
    expect(revalidatePath).toHaveBeenCalledWith('/communication/circulars/c1');
    expect(revalidatePath).toHaveBeenCalledWith('/communication/delivery');
  });

  it('ack rejects a blank recipient without calling the gateway', async () => {
    expect((await ackCircularAction('c1', '  ')).status).toBe('error');
    expect(api.ackCircular).not.toHaveBeenCalled();
  });

  it('ack maps a gateway 403 to its message', async () => {
    api.ackCircular.mockRejectedValue(
      new GatewayError({ status: 403, code: 'FORBIDDEN', message: 'Forbidden' }),
    );
    expect(await ackCircularAction('c1', 'r1')).toEqual({ status: 'error', message: 'Forbidden' });
  });
});

describe('delivery retry', () => {
  it('revalidates the delivery log on success', async () => {
    api.retryDeliveryLog.mockResolvedValue({ id: 'd1', status: 'queued' });
    const result = await retryDeliveryAction('d1');
    expect(result).toMatchObject({ status: 'success', id: 'd1' });
    expect(revalidatePath).toHaveBeenCalledWith('/communication/delivery');
  });
});
