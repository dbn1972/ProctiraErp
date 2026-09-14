/**
 * G-922 WhatsApp sandbox adapter + W1-ARCH-08 env factory.
 */
import { describe, expect, it, vi } from 'vitest';

import { CircularsService } from './circulars-service.js';
import { InMemoryCircularStore } from './circular-store.js';
import {
  createSandboxWhatsAppAdapter,
  createWhatsAppAdapter,
  WHATSAPP_LIVE_ENV_VARS,
  WHATSAPP_LIVE_MISSING_CREDS_NOTE,
  WHATSAPP_LIVE_UNIMPLEMENTED_NOTE,
  WHATSAPP_REQUIRED_LIVE_ENV_VARS,
  WHATSAPP_SANDBOX_HONESTY_NOTE,
  type WhatsAppChannelAdapter,
  type WhatsAppSendRequest,
} from './whatsapp-adapter.js';

const sampleRequest: WhatsAppSendRequest = {
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
  recipientId: 'staff-1',
  body: 'School closed tomorrow',
  sourceType: 'circular',
  sourceId: 'circ-1',
};

const liveCreds = {
  WHATSAPP_PROVIDER: 'meta',
  WHATSAPP_ACCESS_TOKEN: 'token',
  WHATSAPP_PHONE_NUMBER_ID: 'phone-1',
};

describe('createSandboxWhatsAppAdapter (G-922)', () => {
  it('returns sandbox metadata without calling a provider', async () => {
    const adapter = createSandboxWhatsAppAdapter();
    const result = await adapter.send(sampleRequest);
    expect(result.mode).toBe('sandbox');
    expect(result.status).toBe('sent');
    expect(result.providerRef).toMatch(/^sandbox-wa:/);
    expect(result.honestyNote).toBe(WHATSAPP_SANDBOX_HONESTY_NOTE);
    expect(WHATSAPP_LIVE_ENV_VARS).toContain('WHATSAPP_ACCESS_TOKEN');
    expect(WHATSAPP_REQUIRED_LIVE_ENV_VARS).toEqual([
      'WHATSAPP_PROVIDER',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
    ]);
  });
});

describe('createWhatsAppAdapter (W1-ARCH-08)', () => {
  it('sandbox / non-live mode returns sandbox adapter', async () => {
    const adapter = createWhatsAppAdapter({});
    const result = await adapter.send(sampleRequest);
    expect(result.mode).toBe('sandbox');
    expect(result.honestyNote).toBe(WHATSAPP_SANDBOX_HONESTY_NOTE);
  });

  it('explicit PROVIDER_MODE=sandbox returns sandbox adapter', async () => {
    const adapter = createWhatsAppAdapter({
      NODE_ENV: 'production',
      PROVIDER_MODE: 'sandbox',
    });
    const result = await adapter.send(sampleRequest);
    expect(result.mode).toBe('sandbox');
  });

  it('live without required WHATSAPP_* credentials fails closed (no silent sandbox)', () => {
    expect(() =>
      createWhatsAppAdapter({ PROVIDER_MODE: 'live' }),
    ).toThrow(WHATSAPP_LIVE_MISSING_CREDS_NOTE);

    expect(() =>
      createWhatsAppAdapter({
        PROVIDER_MODE: 'live',
        WHATSAPP_PROVIDER: 'meta',
        WHATSAPP_ACCESS_TOKEN: 'token',
        // missing WHATSAPP_PHONE_NUMBER_ID
      }),
    ).toThrow(/WHATSAPP_PROVIDER|WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID|W1-ARCH-08/);
  });

  it('production without mode/opt-in fails closed via policy', () => {
    expect(() => createWhatsAppAdapter({ NODE_ENV: 'production' })).toThrow(/W1-ARCH-08/);
  });

  it('live with required credentials returns honest unimplemented stub (not sandbox)', async () => {
    const adapter = createWhatsAppAdapter({
      PROVIDER_MODE: 'live',
      ...liveCreds,
    });
    await expect(adapter.send(sampleRequest)).rejects.toThrow(WHATSAPP_LIVE_UNIMPLEMENTED_NOTE);
  });
});

describe('CircularsService WhatsApp injection (W1-ARCH-08)', () => {
  it('injected adapter wins over env factory default', async () => {
    const send = vi.fn(async () => ({
      mode: 'sandbox' as const,
      providerRef: 'injected-wa:1',
      status: 'sent' as const,
      honestyNote: 'injected',
    }));
    const injected: WhatsAppChannelAdapter = { send };

    const store = new InMemoryCircularStore();
    const service = new CircularsService(store, { whatsappAdapter: injected });
    const circular = await service.createCircular('550e8400-e29b-41d4-a716-446655440001', {
      title: 'Injected WA',
      body: 'body',
      audienceType: 'all',
      channels: ['whatsapp'],
      recipientIds: ['r1'],
    });
    await service.sendCircular('550e8400-e29b-41d4-a716-446655440001', circular.id);

    expect(send).toHaveBeenCalledTimes(1);
    const logs = await service.listDeliveryLogs('550e8400-e29b-41d4-a716-446655440001', {
      channel: 'whatsapp',
    });
    expect(logs[0]!.providerRef).toBe('injected-wa:1');
  });
});
