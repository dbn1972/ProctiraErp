import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  organization?: unknown;
  message?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Stub contact API.
 *
 * Validates the payload shape and emits a structured log entry. A real
 * deployment would forward the message to a ticketing system or CRM. Errors
 * are returned with a stable JSON shape so the client can surface them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: ContactPayload;
  try {
    body = (await request.json()) as ContactPayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const name = asString(body.name).trim();
  const email = asString(body.email).trim();
  const organization = asString(body.organization).trim();
  const message = asString(body.message).trim();

  if (!name) {
    return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'A valid email address is required.' },
      { status: 400 },
    );
  }
  if (!message || message.length < 10) {
    return NextResponse.json(
      { error: 'Message must be at least 10 characters.' },
      { status: 400 },
    );
  }

  // In production: forward to ticketing/CRM. For now, log and respond.
  // eslint-disable-next-line no-console
  console.info('[contact] new submission', {
    name,
    email,
    organization,
    messageLength: message.length,
    receivedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
