'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  CONTACT_LIMITS,
  type ContactFieldErrors,
  validateContactInput,
} from '@/lib/contact-validation';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const FIELD_BASE =
  'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none ' +
  'focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Public contact form.
 *
 * Submits to `/api/contact`. Client validation mirrors the API via
 * `validateContactInput`. Includes a honeypot field and maxLength caps.
 */
export function ContactForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [serverMessage, setServerMessage] = useState<string>('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      organization: String(formData.get('organization') ?? ''),
      message: String(formData.get('message') ?? ''),
      website: String(formData.get('website') ?? ''),
    };

    const result = validateContactInput(payload);
    if (!result.ok) {
      setErrors(result.errors);
      setStatus('idle');
      return;
    }

    setErrors({});
    setStatus('submitting');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.value),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setServerMessage(
          data.error ?? 'Something went wrong. Please try again later.',
        );
        setStatus('error');
        return;
      }
      setServerMessage(
        'Thanks — we will get back to you within two business days.',
      );
      setStatus('success');
      event.currentTarget.reset();
    } catch {
      setServerMessage('Network error. Please try again later.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(event) => void handleSubmit(event)}
    >
      {/* Honeypot — hidden from users; bots that fill it are rejected. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={CONTACT_LIMITS.nameMax}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'name-error' : undefined}
          className={FIELD_BASE}
          disabled={submitting}
        />
        {errors.name ? (
          <p id="name-error" className="mt-1 text-sm text-destructive">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={CONTACT_LIMITS.emailMax}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          className={FIELD_BASE}
          disabled={submitting}
        />
        {errors.email ? (
          <p id="email-error" className="mt-1 text-sm text-destructive">
            {errors.email}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="organization"
          className="text-sm font-medium text-foreground"
        >
          Organization <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="organization"
          name="organization"
          type="text"
          autoComplete="organization"
          maxLength={CONTACT_LIMITS.organizationMax}
          aria-invalid={Boolean(errors.organization)}
          aria-describedby={
            errors.organization ? 'organization-error' : undefined
          }
          className={FIELD_BASE}
          disabled={submitting}
        />
        {errors.organization ? (
          <p id="organization-error" className="mt-1 text-sm text-destructive">
            {errors.organization}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="message" className="text-sm font-medium text-foreground">
          How can we help?
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          required
          maxLength={CONTACT_LIMITS.messageMax}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? 'message-error' : undefined}
          className={`${FIELD_BASE} resize-y`}
          disabled={submitting}
        />
        {errors.message ? (
          <p id="message-error" className="mt-1 text-sm text-destructive">
            {errors.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send message'}
        </Button>
        <p className="text-xs text-muted-foreground">
          By sending, you agree to our{' '}
          <a className="text-primary hover:underline" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>
      </div>

      <div role="status" aria-live="polite" className="min-h-[1.5rem] text-sm">
        {status === 'success' ? (
          <p className="text-accent">{serverMessage}</p>
        ) : null}
        {status === 'error' ? (
          <p className="text-destructive">{serverMessage}</p>
        ) : null}
        {errors.form ? (
          <p className="text-destructive">{errors.form}</p>
        ) : null}
      </div>
    </form>
  );
}
