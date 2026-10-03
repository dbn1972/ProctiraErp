'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  CONTACT_LIMITS,
  type ContactFieldErrors,
  validateContactInput,
} from '@/lib/contact-validation';

type Status = 'idle' | 'submitting' | 'success' | 'error';

/** Field order used to pick the first invalid control to focus. */
export const CONTACT_FIELD_ORDER = ['name', 'email', 'organization', 'message'] as const;

export function firstInvalidField(
  errors: ContactFieldErrors,
): (typeof CONTACT_FIELD_ORDER)[number] | null {
  return CONTACT_FIELD_ORDER.find((field) => Boolean(errors[field])) ?? null;
}

export function errorSummary(errors: ContactFieldErrors): string {
  const count = CONTACT_FIELD_ORDER.filter((field) => Boolean(errors[field])).length;
  if (count === 0) return '';
  return count === 1
    ? 'Please fix 1 field before sending.'
    : `Please fix ${count} fields before sending.`;
}

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
  // PRC-M049: when delivery fails the server returns a fallback address to write to.
  const [fallbackEmail, setFallbackEmail] = useState<string>('');
  // Bumped on each failed client validation so focus moves even if errors repeat.
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    const field = firstInvalidField(errors);
    if (!field) return;
    const control = formRef.current?.elements.namedItem(field);
    if (control instanceof HTMLElement) control.focus();
  }, [focusRequest, errors]);

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
      setFocusRequest((n) => n + 1);
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
          fallbackEmail?: string;
        };
        setServerMessage(data.error ?? 'Something went wrong. Please try again later.');
        setFallbackEmail(
          typeof data.fallbackEmail === 'string' && /^[^\s@]+@[^\s@]+$/.test(data.fallbackEmail)
            ? data.fallbackEmail
            : '',
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
    <form
      ref={formRef}
      noValidate
      aria-label="Contact form"
      className="space-y-5"
      onSubmit={(event) => void handleSubmit(event)}
    >
      {/* Announced once per failed submit; field errors are linked via aria-describedby. */}
      <div role="alert" className="text-sm font-medium text-destructive empty:hidden">
        {errorSummary(errors)}
      </div>

      {/* Honeypot — hidden from users; bots that fill it are rejected. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
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
        <label htmlFor="organization" className="text-sm font-medium text-foreground">
          Organization <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="organization"
          name="organization"
          type="text"
          autoComplete="organization"
          maxLength={CONTACT_LIMITS.organizationMax}
          aria-invalid={Boolean(errors.organization)}
          aria-describedby={errors.organization ? 'organization-error' : undefined}
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
          <a className="font-medium text-primary underline underline-offset-2" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>
      </div>

      <div role="status" aria-live="polite" className="min-h-[1.5rem] text-sm">
        {status === 'success' ? <p className="text-accent">{serverMessage}</p> : null}
        {status === 'error' ? (
          <p className="text-destructive">
            {serverMessage}
            {fallbackEmail ? (
              <>
                {' '}
                <a className="underline" href={`mailto:${fallbackEmail}`}>
                  Email {fallbackEmail}
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {errors.form ? <p className="text-destructive">{errors.form}</p> : null}
      </div>
    </form>
  );
}
