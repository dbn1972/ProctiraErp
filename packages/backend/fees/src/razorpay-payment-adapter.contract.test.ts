/**
 * PRC-M512: Razorpay adapter + webhook contract tests against a stubbed provider
 * (a local HTTP server speaking the Orders / Refunds API shapes). No real keys:
 * the live Razorpay test-mode run waits for credentials in the secret manager.
 */
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { createPaymentAdapterFromEnv, UnimplementedLivePaymentAdapter } from './payment-adapter.js';
import {
  RazorpayPaymentAdapter,
  RazorpayWebhookSignatureError,
  verifyRazorpayWebhookSignature,
} from './razorpay-payment-adapter.js';
import { settleRazorpayWebhook } from './razorpay-webhook.js';

const KEY_ID = 'rzp_test_stubkey';
const KEY_SECRET = 'stub-key-secret';
const WEBHOOK_SECRET = 'stub-webhook-secret';
const TENANT = '00000000-0000-4000-8000-000000000001';
const STUDENT = '00000000-0000-4000-8000-000000000099';

interface StubCall {
  method: string;
  url: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
const calls: StubCall[] = [];
let refuseNext = false;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    calls.push({
      method: req.method ?? '',
      url: req.url ?? '',
      auth: req.headers.authorization,
      body,
    });
    const expectedAuth = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`;
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== expectedAuth || refuseNext) {
      refuseNext = false;
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'auth' } }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/orders') {
      res.end(
        JSON.stringify({
          id: 'order_Stub123',
          entity: 'order',
          amount: body.amount,
          status: 'created',
        }),
      );
      return;
    }
    const refund = req.url?.match(/^\/v1\/payments\/(pay_[A-Za-z0-9]+)\/refund$/);
    if (req.method === 'POST' && refund) {
      res.end(
        JSON.stringify({
          id: 'rfnd_Stub1',
          payment_id: refund[1],
          amount: body.amount,
          status: 'processed',
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  calls.length = 0;
  refuseNext = false;
});

function adapter() {
  return new RazorpayPaymentAdapter({
    keyId: KEY_ID,
    keySecret: KEY_SECRET,
    webhookSecret: WEBHOOK_SECRET,
    apiBaseUrl: baseUrl,
  });
}

function signed(event: Record<string, unknown>) {
  const rawBody = JSON.stringify(event);
  return {
    rawBody,
    signature: createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'),
  };
}

function capturedEvent(invoiceId: string, amount: number, paymentId = 'pay_Stub001') {
  return {
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: 'order_Stub123',
          amount,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
          notes: { tenantId: TENANT, invoiceId, payerUserId: 'parent-1' },
        },
      },
    },
  };
}

describe('PRC-M512 Razorpay adapter (stubbed provider)', () => {
  it('charge() opens an order with Basic auth and integer paise, and returns pending', async () => {
    const result = await adapter().charge({
      tenantId: TENANT,
      invoiceId: 'inv-1',
      payerUserId: 'parent-1',
      amountCents: 125_050,
      currency: 'INR',
    });
    expect(result).toMatchObject({
      status: 'pending',
      reference: 'order_Stub123',
      amountCents: 125_050,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v1/orders' });
    expect(calls[0]!.body).toMatchObject({
      amount: 125_050,
      currency: 'INR',
      notes: { tenantId: TENANT, invoiceId: 'inv-1', payerUserId: 'parent-1' },
    });
  });

  it('charge() fails closed when the provider refuses; recordPayment never marks the invoice paid', async () => {
    refuseNext = true;
    const refused = await adapter().charge({
      tenantId: TENANT,
      invoiceId: 'inv-1',
      payerUserId: 'p',
      amountCents: 100,
      currency: 'INR',
    });
    expect(refused.status).toBe('failed');

    const repository = new InMemoryFeesRepository();
    const service = new FeesService(repository, adapter());
    const invoice = await service.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Tuition',
      amountCents: 10_000,
    });
    await expect(
      service.recordPayment(TENANT, 'parent-1', { invoiceId: invoice.id }),
    ).rejects.toThrow(/pending/);
    expect((await service.getInvoice(TENANT, invoice.id)).status).toBe('open');
    expect(await repository.listPaymentsForInvoice(TENANT, invoice.id)).toHaveLength(0);
  });

  it('refund() calls the Refunds API for a captured payment id', async () => {
    const refund = await adapter().refund('pay_Stub001', 2_500, { invoiceId: 'inv-1' });
    expect(refund).toEqual({ refundId: 'rfnd_Stub1', status: 'processed', amountCents: 2_500 });
    expect(calls[0]).toMatchObject({
      url: '/v1/payments/pay_Stub001/refund',
      body: { amount: 2_500 },
    });
    await expect(adapter().refund('../orders', 1)).rejects.toThrow(/Razorpay payment id/);
  });

  it('createPaymentAdapterFromEnv picks Razorpay only in live mode with all three secrets', () => {
    const live = {
      PROVIDER_MODE: 'live',
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };
    expect(createPaymentAdapterFromEnv(live)).toBeInstanceOf(RazorpayPaymentAdapter);
    expect(createPaymentAdapterFromEnv({ ...live, RAZORPAY_WEBHOOK_SECRET: '' })).toBeInstanceOf(
      UnimplementedLivePaymentAdapter,
    );
  });
});

describe('PRC-M512 Razorpay webhook settlement', () => {
  let repository: InMemoryFeesRepository;
  let invoiceId: string;
  beforeEach(async () => {
    repository = new InMemoryFeesRepository();
    const staff = new FeesService(repository);
    const invoice = await staff.createInvoice(TENANT, 'staff-1', {
      studentId: STUDENT,
      title: 'Tuition',
      amountCents: 10_000,
    });
    invoiceId = invoice.id;
  });

  it('verifies the signature in constant time and rejects a tampered body', () => {
    const { rawBody, signature } = signed(capturedEvent(invoiceId, 10_000));
    expect(verifyRazorpayWebhookSignature(rawBody, signature, WEBHOOK_SECRET)).toBe(true);
    expect(
      verifyRazorpayWebhookSignature(rawBody.replace('10000', '1'), signature, WEBHOOK_SECRET),
    ).toBe(false);
    expect(verifyRazorpayWebhookSignature(rawBody, undefined, WEBHOOK_SECRET)).toBe(false);
    expect(verifyRazorpayWebhookSignature(rawBody, 'zz', WEBHOOK_SECRET)).toBe(false);
  });

  it('a verified payment.captured settles the invoice once; a redelivery replays', async () => {
    const { rawBody, signature } = signed(capturedEvent(invoiceId, 10_000));
    const first = await settleRazorpayWebhook({
      repository,
      rawBody,
      signature,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(first).toMatchObject({ settled: true, idempotent: false, invoiceStatus: 'paid' });
    const again = await settleRazorpayWebhook({
      repository,
      rawBody,
      signature,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(again).toMatchObject({ settled: true, idempotent: true });
    const payments = await repository.listPaymentsForInvoice(TENANT, invoiceId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      amountCents: 10_000,
      method: 'upi',
      payerUserId: 'parent-1',
      idempotencyKey: 'razorpay:pay_Stub001',
    });
  });

  it('a bad signature writes nothing; other events are ignored', async () => {
    const { rawBody } = signed(capturedEvent(invoiceId, 10_000));
    await expect(
      settleRazorpayWebhook({
        repository,
        rawBody,
        signature: 'a'.repeat(64),
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).rejects.toBeInstanceOf(RazorpayWebhookSignatureError);
    const failedEvent = signed({ event: 'payment.failed', payload: {} });
    expect(
      await settleRazorpayWebhook({ repository, ...failedEvent, webhookSecret: WEBHOOK_SECRET }),
    ).toEqual({ settled: false, reason: 'ignored_event' });
    expect(await repository.listPaymentsForInvoice(TENANT, invoiceId)).toHaveLength(0);
  });

  it('a captured amount above the remaining balance is refused, not recorded', async () => {
    const { rawBody, signature } = signed(capturedEvent(invoiceId, 10_001, 'pay_Stub002'));
    await expect(
      settleRazorpayWebhook({ repository, rawBody, signature, webhookSecret: WEBHOOK_SECRET }),
    ).rejects.toThrow(/exceeds remaining balance/);
    expect(await repository.listPaymentsForInvoice(TENANT, invoiceId)).toHaveLength(0);
  });
});
