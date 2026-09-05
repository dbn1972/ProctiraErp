import { NextResponse } from 'next/server';

import { allowContactRequest } from '@/lib/contact-rate-limit';
import { validateContactInput } from '@/lib/contact-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Stub contact API.
 *
 * Validates the payload (shared with the client form), applies a process-local
 * rate limit, and emits a structured log entry without echoing the message
 * body. A real deployment would forward to ticketing/CRM behind edge throttling.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!allowContactRequest(clientKey(request))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const result = validateContactInput({
    name: payload.name,
    email: payload.email,
    organization: payload.organization,
    message: payload.message,
    website: payload.website,
  });

  if (!result.ok) {
    const message =
      result.errors.form ??
      result.errors.name ??
      result.errors.email ??
      result.errors.organization ??
      result.errors.message ??
      'Invalid contact payload.';
    return NextResponse.json({ error: message, errors: result.errors }, { status: 400 });
  }

  // In production: forward to ticketing/CRM. Log metadata only (no message body).
  // eslint-disable-next-line no-console
  console.info('[contact] new submission', {
    name: result.value.name,
    email: result.value.email,
    organization: result.value.organization,
    messageLength: result.value.message.length,
    receivedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
