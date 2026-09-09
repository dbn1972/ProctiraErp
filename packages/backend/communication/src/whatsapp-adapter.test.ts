/**
 * G-922 WhatsApp sandbox adapter — no network.
 */
import { describe, expect, it } from 'vitest';

import {
  createSandboxWhatsAppAdapter,
  WHATSAPP_LIVE_ENV_VARS,
  WHATSAPP_SANDBOX_HONESTY_NOTE,
} from './whatsapp-adapter.js';

describe('createSandboxWhatsAppAdapter (G-922)', () => {
  it('returns sandbox metadata without calling a provider', async () => {
    const adapter = createSandboxWhatsAppAdapter();
    const result = await adapter.send({
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      recipientId: 'staff-1',
      body: 'School closed tomorrow',
      sourceType: 'circular',
      sourceId: 'circ-1',
    });
    expect(result.mode).toBe('sandbox');
    expect(result.status).toBe('sent');
    expect(result.providerRef).toMatch(/^sandbox-wa:/);
    expect(result.honestyNote).toBe(WHATSAPP_SANDBOX_HONESTY_NOTE);
    expect(WHATSAPP_LIVE_ENV_VARS).toContain('WHATSAPP_ACCESS_TOKEN');
  });
});
