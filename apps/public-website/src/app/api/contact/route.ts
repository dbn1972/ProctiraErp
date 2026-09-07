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

async function forwardToWebhook(payload: {
  name: string;
  email: string;
  organization: string;
  message: string;
}): Promise<'forwarded' | 'skipped' | 'failed'> {
  const webhookUrl = process.env.CONTACT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return 'skipped';

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'ProctiraERP-public-website/contact',
      },
      body: JSON.stringify({
        ...payload,
        source: 'public-website/contact',
        receivedAt: new Date().toISOString(),
      }),
      // Avoid hanging the contact UX on a slow CRM.
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn('[contact] webhook forward failed', {
        status: response.status,
        messageLength: payload.message.length,
      });
      return 'failed';
    }
    return 'forwarded';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[contact] webhook forward error', {
      message: error instanceof Error ? error.message : 'unknown',
      messageLength: payload.message.length,
    });
    return 'failed';
  }
}

/**
 * Contact API.
 *
 * Validates the payload (shared with the client form), applies a process-local
 * rate limit, optionally forwards to CONTACT_WEBHOOK_URL (CRM/ticketing), and
 * emits a structured log entry without echoing the message body.
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

  const forward = await forwardToWebhook(result.value);

  // Log metadata only (no message body).
  // eslint-disable-next-line no-console
  console.info('[contact] new submission', {
    name: result.value.name,
    email: result.value.email,
    organization: result.value.organization,
    messageLength: result.value.message.length,
    webhook: forward,
    receivedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      ok: true,
      // Honesty for operators: accepted locally even if webhook failed/skipped.
      forwarded: forward === 'forwarded',
    },
    { status: 202 },
  );
}
