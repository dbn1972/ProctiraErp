/**
 * @vitest-environment jsdom
 *
 * PRC-H024 / PRC-H033 — lesson resource URLs must be http(s) on write and on
 * render; legacy non-http rows render as inert text, never as a link.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lmsContentSchema, lmsLessonSchema } from '@/lib/validation/lms-depth-schema';
import { ResourceLink } from './resource-link';

const UUID = '12345678-1234-4234-8234-123456789abc';
const UNSAFE = [
  'javascript:alert(1)',
  ' JavaScript:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//evil.example',
];

describe('lmsLessonSchema resourceUrl', () => {
  it.each(UNSAFE)('rejects %j', (resourceUrl) => {
    const parsed = lmsLessonSchema.safeParse({ institutionId: UUID, title: 'T', resourceUrl });
    expect(parsed.success).toBe(false);
  });

  it('accepts https and empty', () => {
    for (const resourceUrl of ['https://example.edu/a', 'http://example.edu', '']) {
      expect(
        lmsLessonSchema.safeParse({ institutionId: UUID, title: 'T', resourceUrl }).success,
      ).toBe(true);
    }
  });
});

describe('lmsContentSchema link body', () => {
  it('rejects a javascript: link body but allows text bodies', () => {
    const base = { scope: 'school', institutionId: UUID, title: 'T' } as const;
    expect(
      lmsContentSchema.safeParse({ ...base, kind: 'link', body: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      lmsContentSchema.safeParse({ ...base, kind: 'link', body: 'https://example.edu' }).success,
    ).toBe(true);
    expect(
      lmsContentSchema.safeParse({ ...base, kind: 'text', body: 'javascript: is a word' }).success,
    ).toBe(true);
  });
});

describe('ResourceLink', () => {
  it.each(UNSAFE)('renders %j as plain text, not a link', (url) => {
    const { container } = render(<ResourceLink url={url} />);
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByTestId('lms-resource-unsafe-url')).toBeTruthy();
  });

  it('renders https as a new-tab link with noopener noreferrer', () => {
    render(<ResourceLink url="https://example.edu/fractions" />);
    const link = screen.getByRole('link', { name: /example\.edu\/fractions/ });
    expect(link.getAttribute('href')).toBe('https://example.edu/fractions');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
