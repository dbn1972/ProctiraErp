/**
 * PRC-M512: settle a verified Razorpay `payment.captured` webhook into the fee ledger.
 *
 * The signature is checked before anything is parsed or written. The captured payment
 * is recorded through FeesService.recordPayment (invoice lock, remaining-balance cap,
 * receipt, journal) with a charge adapter bound to exactly that captured payment, and
 * the Razorpay payment id as idempotency key, so a redelivered webhook replays.
 */
import type { FeesRepository } from './fees-repository.js';
import { FeesService } from './fees-service.js';
import {
  parseRazorpayWebhook,
  VerifiedCapturedPaymentAdapter,
  type RazorpayCapturedPayment,
} from './razorpay-payment-adapter.js';

export const RAZORPAY_PSP_ACTOR = 'psp:razorpay';

export type RazorpayWebhookOutcome =
  | { settled: false; reason: 'ignored_event' }
  | {
      settled: true;
      idempotent: boolean;
      captured: RazorpayCapturedPayment;
      paymentId: string;
      invoiceStatus: string;
    };

export async function settleRazorpayWebhook(input: {
  repository: FeesRepository;
  rawBody: string | Buffer;
  signature: string | undefined;
  webhookSecret: string;
}): Promise<RazorpayWebhookOutcome> {
  const captured = parseRazorpayWebhook(input.rawBody, input.signature, input.webhookSecret);
  if (!captured) return { settled: false, reason: 'ignored_event' };
  const service = new FeesService(input.repository, new VerifiedCapturedPaymentAdapter(captured));
  const result = await service.recordPayment(captured.tenantId, RAZORPAY_PSP_ACTOR, {
    invoiceId: captured.invoiceId,
    payerUserId: captured.payerUserId,
    method: captured.method,
    amountCents: captured.amountCents,
    idempotencyKey: `razorpay:${captured.providerPaymentId}`,
    reference: captured.providerPaymentId,
  });
  return {
    settled: true,
    idempotent: result.idempotent,
    captured,
    paymentId: result.payment.id,
    invoiceStatus: result.invoice.status,
  };
}
