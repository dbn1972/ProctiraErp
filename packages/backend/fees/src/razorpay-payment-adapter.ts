/**
 * PRC-M512: Razorpay payment adapter + webhook verification (owner decision DR36:
 * Razorpay, test mode first; credentials only from the secret manager).
 *
 * No SDK dependency: the Orders and Refunds REST endpoints are called with `fetch`
 * and HTTP Basic auth (key id + key secret). Money is integer minor units (paise).
 *
 * Settlement model (fail closed):
 *   - `charge()` creates a Razorpay order and returns `pending` with the order id.
 *     A server-side order moves no money, so FeesService never marks an invoice
 *     paid from `charge()` alone.
 *   - Money is recorded only from a `payment.captured` webhook whose
 *     `X-Razorpay-Signature` (HMAC-SHA256 of the raw body with the webhook secret)
 *     verifies. The captured payment is settled through FeesService.recordPayment
 *     with the Razorpay payment id as idempotency key, so a redelivered webhook
 *     replays instead of double-recording.
 *
 * Env var names (values live in the secret manager): RAZORPAY_KEY_ID,
 * RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, optional RAZORPAY_API_BASE_URL.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { BusinessRuleError } from '@proctira/common';

import type { PaymentMethod } from './fees-repository.js';
import type { ChargeInput, ChargeResult, PaymentAdapter } from './payment-adapter.js';

export const RAZORPAY_DEFAULT_API_BASE_URL = 'https://api.razorpay.com/v1';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  apiBaseUrl?: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Razorpay credentials from env; null unless all three secrets are set. */
export function loadRazorpayConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!keyId || !keySecret || !webhookSecret) return null;
  const apiBaseUrl = env.RAZORPAY_API_BASE_URL?.trim();
  return { keyId, keySecret, webhookSecret, ...(apiBaseUrl ? { apiBaseUrl } : {}) };
}

export class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Razorpay request failed (${status} ${code})`);
    this.name = 'RazorpayApiError';
  }
}

export class RazorpayPaymentAdapter implements PaymentAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: RazorpayConfig,
    fetchImpl?: FetchLike,
  ) {
    this.baseUrl = (config.apiBaseUrl ?? RAZORPAY_DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const auth = Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64');
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const code =
        (parsed as { error?: { code?: unknown } } | null)?.error?.code ?? 'UNKNOWN_ERROR';
      // Never echo the provider body: it can carry payer details.
      throw new RazorpayApiError(response.status, String(code));
    }
    return parsed as T;
  }

  /**
   * Creates an order for the payer's checkout and returns `pending` with the order id.
   * Fails closed (status `failed`) when the provider refuses or is unreachable.
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BusinessRuleError('Razorpay order amount must be a positive integer (paise)');
    }
    try {
      const order = await this.request<{ id?: unknown; amount?: unknown; status?: unknown }>(
        '/orders',
        {
          amount: input.amountCents,
          currency: input.currency,
          receipt: input.invoiceId.slice(0, 40),
          notes: {
            tenantId: input.tenantId,
            invoiceId: input.invoiceId,
            payerUserId: input.payerUserId,
          },
        },
      );
      if (typeof order?.id !== 'string' || order.amount !== input.amountCents) {
        return this.failed(input, 'razorpay-order-invalid');
      }
      return {
        status: 'pending',
        method: input.method ?? 'card',
        amountCents: input.amountCents,
        reference: order.id,
      };
    } catch {
      return this.failed(input, 'razorpay-order-refused');
    }
  }

  /** Refunds part or all of a captured Razorpay payment (Refunds API). */
  async refund(
    providerPaymentId: string,
    amountCents: number,
    notes: Record<string, string> = {},
  ): Promise<{ refundId: string; status: string; amountCents: number }> {
    if (!/^pay_[A-Za-z0-9]+$/.test(providerPaymentId)) {
      throw new BusinessRuleError('Not a Razorpay payment id');
    }
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new BusinessRuleError('Razorpay refund amount must be a positive integer (paise)');
    }
    const refund = await this.request<{ id?: unknown; status?: unknown; amount?: unknown }>(
      `/payments/${encodeURIComponent(providerPaymentId)}/refund`,
      { amount: amountCents, notes },
    );
    if (typeof refund?.id !== 'string' || refund.amount !== amountCents) {
      throw new RazorpayApiError(502, 'INVALID_REFUND_RESPONSE');
    }
    return { refundId: refund.id, status: String(refund.status ?? 'pending'), amountCents };
  }

  private failed(input: ChargeInput, reference: string): ChargeResult {
    return {
      status: 'failed',
      method: input.method ?? 'card',
      amountCents: input.amountCents,
      reference,
    };
  }
}

/** Constant-time check of `X-Razorpay-Signature` (hex HMAC-SHA256 of the raw body). */
export function verifyRazorpayWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signature || !webhookSecret || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A verified, captured Razorpay payment mapped to a fee invoice. */
export interface RazorpayCapturedPayment {
  providerPaymentId: string;
  orderId: string | null;
  tenantId: string;
  invoiceId: string;
  /** Payer recorded on the order notes; `psp:razorpay` when absent. */
  payerUserId: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
}

function mapRazorpayMethod(method: unknown): PaymentMethod {
  return method === 'upi' ? 'upi' : 'card';
}

/**
 * Verifies the signature, then returns the captured payment, or null for an event
 * that settles nothing (any event other than `payment.captured`). Throws on a bad
 * signature or a captured event without tenant/invoice notes.
 */
export function parseRazorpayWebhook(
  rawBody: string | Buffer,
  signature: string | undefined,
  webhookSecret: string,
): RazorpayCapturedPayment | null {
  if (!verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)) {
    throw new RazorpayWebhookSignatureError();
  }
  const event = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) as {
    event?: unknown;
    payload?: { payment?: { entity?: Record<string, unknown> } };
  };
  if (event.event !== 'payment.captured') return null;
  const entity = event.payload?.payment?.entity ?? {};
  const notes = (entity.notes ?? {}) as Record<string, unknown>;
  const amount = entity.amount;
  if (
    typeof entity.id !== 'string' ||
    typeof notes.tenantId !== 'string' ||
    typeof notes.invoiceId !== 'string' ||
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof entity.currency !== 'string'
  ) {
    throw new BusinessRuleError('Razorpay payment.captured event is missing payment fields');
  }
  return {
    providerPaymentId: entity.id,
    orderId: typeof entity.order_id === 'string' ? entity.order_id : null,
    tenantId: notes.tenantId,
    invoiceId: notes.invoiceId,
    payerUserId:
      typeof notes.payerUserId === 'string' && notes.payerUserId
        ? notes.payerUserId
        : 'psp:razorpay',
    amountCents: amount,
    currency: entity.currency,
    method: mapRazorpayMethod(entity.method),
  };
}

export class RazorpayWebhookSignatureError extends Error {
  readonly statusCode = 401;
  constructor() {
    super('Razorpay webhook signature does not verify');
    this.name = 'RazorpayWebhookSignatureError';
  }
}

/**
 * Charge adapter bound to ONE verified captured payment: it succeeds only for the
 * same tenant, invoice, amount and currency, so the webhook settles exactly what
 * Razorpay captured and nothing else.
 */
export class VerifiedCapturedPaymentAdapter implements PaymentAdapter {
  constructor(private readonly captured: RazorpayCapturedPayment) {}

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const matches =
      input.tenantId === this.captured.tenantId &&
      input.invoiceId === this.captured.invoiceId &&
      input.amountCents === this.captured.amountCents &&
      input.currency === this.captured.currency;
    return {
      status: matches ? 'succeeded' : 'failed',
      method: this.captured.method,
      amountCents: input.amountCents,
      reference: this.captured.providerPaymentId,
    };
  }
}
