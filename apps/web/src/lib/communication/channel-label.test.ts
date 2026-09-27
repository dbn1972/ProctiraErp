import { describe, expect, it } from 'vitest';

import { channelLabel } from './channel-label';

describe('channelLabel', () => {
  it('names the sandbox channels in plain language', () => {
    expect(channelLabel('in_app')).toBe('In app');
    expect(channelLabel('whatsapp')).toBe('WhatsApp');
    expect(channelLabel('sms')).toBe('SMS');
  });

  it('does not leave underscores in an unknown channel', () => {
    expect(channelLabel('parent_digest')).toBe('Parent digest');
  });
});
