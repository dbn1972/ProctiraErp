import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContactForm, errorSummary, firstInvalidField } from './contact-form';
import { validateContactInput } from '@/lib/contact-validation';

describe('contact form error handling', () => {
  it('targets the first invalid field in visual order on an empty submit', () => {
    const result = validateContactInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstInvalidField(result.errors)).toBe('name');
      expect(errorSummary(result.errors)).toBe('Please fix 3 fields before sending.');
    }
    expect(firstInvalidField({ message: 'x', email: 'y' })).toBe('email');
    expect(errorSummary({})).toBe('');
  });

  it('renders an alert region for error announcements and keeps the honeypot hidden', () => {
    const html = renderToStaticMarkup(createElement(ContactForm));
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/aria-hidden="true"[^>]*><label for="website"/);
    expect(html).toContain('tabindex="-1"');
  });
});
