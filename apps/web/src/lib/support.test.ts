import { describe, expect, it } from 'vitest';

import { resolveSupportTicketHref } from './support';

describe('resolveSupportTicketHref (G-924)', () => {
  it('prefers a configured help-desk URL', () => {
    expect(
      resolveSupportTicketHref({
        NEXT_PUBLIC_SUPPORT_TICKET_URL: 'https://helpdesk.example.org/new',
        NEXT_PUBLIC_SUPPORT_EMAIL: 'support@example.org',
      }),
    ).toBe('https://helpdesk.example.org/new');
  });

  it('falls back to a mailto link and rejects non-http schemes', () => {
    expect(
      resolveSupportTicketHref({
        NEXT_PUBLIC_SUPPORT_TICKET_URL: 'javascript:alert(1)',
        NEXT_PUBLIC_SUPPORT_EMAIL: 'support@example.org',
      }),
    ).toMatch(/^mailto:support@example\.org\?subject=/);
  });

  it('returns null when nothing is configured', () => {
    expect(resolveSupportTicketHref({})).toBeNull();
    expect(resolveSupportTicketHref({ NEXT_PUBLIC_SUPPORT_EMAIL: 'not-an-email' })).toBeNull();
  });
});
