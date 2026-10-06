import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { allowContactRequest, resolveClientKey } from '@/lib/contact-rate-limit';
import {
  BodyTooLargeError,
  checkJsonContentType,
  checkSameOrigin,
  readBodyWithLimit,
  resolveWebhookUrl,
} from '@/lib/contact-request-guard';
import { CONTACT_FALLBACK_EMAIL, maskEmailForLog } from '@/lib/contact-delivery';
import { validateContactInput } from '@/lib/contact-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PRC-M049: transient CRM failures are retried before the visitor is told it failed. */
const WEBHOOK_ATTEMPTS = 3;
const WEBHOOK_RETRY_BASE_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ContactPayload = {
  name: string;
  email: string;
  organization: string;
  message: string;
};

type ForwardOutcome = 'forwarded' | 'skipped' | 'failed';

/** PRC-M049: retry transient failures (network/5xx/429); 4xx other than 429 is final. */
async function forwardToWebhook(
  payload: ContactPayload,
  requestId: string,
): Promise<ForwardOutcome> {
  if (!process.env.CONTACT_WEBHOOK_URL?.trim()) return 'skipped';
  const webhookUrl = resolveWebhookUrl();
  if (!webhookUrl) {
    // eslint-disable-next-line no-console
    console.warn('[contact] CONTACT_WEBHOOK_URL ignored: must be a valid https URL');
    return 'failed';
  }
  for (let attempt = 1; attempt <= WEBHOOK_ATTEMPTS; attempt += 1) {
    const outcome = await forwardOnce(webhookUrl, payload, requestId, attempt);
    if (outcome !== 'retry') return outcome;
    if (attempt < WEBHOOK_ATTEMPTS) await sleep(WEBHOOK_RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  return 'failed';
}

async function forwardOnce(
  webhookUrl: URL,
  payload: ContactPayload,
  requestId: string,
  attempt: number,
): Promise<'forwarded' | 'failed' | 'retry'> {
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
        requestId,
        source: 'public-website/contact',
        receivedAt: new Date().toISOString(),
      }),
      // Avoid hanging the contact UX on a slow CRM.
      signal: AbortSignal.timeout(5_000),
      // Never follow a redirect off the configured CRM endpoint.
      redirect: 'error',
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn('[contact] webhook forward failed', {
        requestId,
        attempt,
        status: response.status,
      });
      return response.status >= 500 || response.status === 429 ? 'retry' : 'failed';
    }
    return 'forwarded';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[contact] webhook forward error', {
      requestId,
      attempt,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return 'retry';
  }
}

/**
 * Contact API.
 *
 * Validates the payload (shared with the client form), applies a process-local
 * rate limit and forwards to CONTACT_WEBHOOK_URL (CRM/ticketing) with retries.
 *
 * PRC-M049: the visitor is only told the message was received when the CRM accepted it;
 * otherwise the route answers 503 with a fallback address. PRC-M050: logs carry a request id,
 * a masked email and the message length only.
 */
export async function POST(request: Request): Promise<NextResponse> {
  for (const verdict of [checkSameOrigin(request.headers), checkJsonContentType(request.headers)]) {
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    }
  }
  if (!allowContactRequest(resolveClientKey(request.headers))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBodyWithLimit(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
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

  const requestId = randomUUID();
  const forward = await forwardToWebhook(result.value, requestId);
  // PRC-M050: no name, organisation, raw email or message body in logs.
  // eslint-disable-next-line no-console
  console.info('[contact] new submission', {
    requestId,
    email: maskEmailForLog(result.value.email),
    messageLength: result.value.message.length,
    webhook: forward,
    receivedAt: new Date().toISOString(),
  });
  if (forward !== 'forwarded') {
    // PRC-M049: nothing durable holds the message, so never claim it was received.
    return NextResponse.json(
      {
        ok: false,
        forwarded: false,
        requestId,
        fallbackEmail: CONTACT_FALLBACK_EMAIL,
        error: `We could not deliver your message right now. Please email ${CONTACT_FALLBACK_EMAIL} or try again later.`,
      },
      { status: 503, headers: { 'Retry-After': '60' } },
    );
  }
  return NextResponse.json({ ok: true, forwarded: true, requestId }, { status: 202 });
}
