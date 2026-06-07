'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

type Status = 'idle' | 'submitting' | 'success' | 'error';

interface FormFieldErrors {
  name?: string;
  email?: string;
  message?: string;
}

const FIELD_BASE =
  'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none ' +
  'focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Public contact form.
 *
 * Submits to `/api/contact`, a stub route that records the submission
 * server-side. Performs HTML5 + lightweight client validation, exposes
 * inline error messages with `aria-describedby`, and announces the result
 * to assistive technology via a live region.
 */
export function ContactForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<FormFieldErrors>({});
  const [serverMessage, setServerMessage] = useState<string>('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get('name') ?? '').trim(),
      email: String(formData.get('email') ?? '').trim(),
      organization: String(formData.get('organization') ?? '').trim(),
      message: String(formData.get('message') ?? '').trim(),
    };

    const fieldErrors: FormFieldErrors = {};
    if (!payload.name) fieldErrors.name = 'Please enter your name.';
    if (!payload.email) {
      fieldErrors.email = 'Please enter your email.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      fieldErrors.email = 'Please enter a valid email address.';
    }
    if (!payload.message || payload.message.length < 10) {
      fieldErrors.message = 'Tell us a little more (at least 10 characters).';
    }

    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setStatus('idle');
      return;
    }

    setStatus('submitting');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      setServerMessage('Thanks — we will get back to you within two business days.');
      setStatus('success');
      event.currentTarget.reset();
    } catch {
      setServerMessage('Network error. Please try again later.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form noValidate className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
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
          className={FIELD_BASE}
          disabled={submitting}
        />
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
      </div>
    </form>
  );
}
