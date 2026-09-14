/**
 * Payment adapter interface + sandbox stub (G-202 waived for live PSP).
 * W2-INT-03: PROVIDER_MODE=live must not silently succeed via the sandbox stub.
 */
import type { PaymentMethod } from './fees-repository.js';

export interface ChargeInput {
  tenantId: string;
  invoiceId: string;
  payerUserId: string;
  amountCents: number;
  currency: string;
  method?: PaymentMethod;
}

export interface ChargeResult {
  status: 'succeeded' | 'failed' | 'pending';
  method: PaymentMethod;
  amountCents: number;
  reference: string;
}

export interface PaymentAdapter {
  charge(input: ChargeInput): Promise<ChargeResult>;
}

/**
 * Always succeeds — honest sandbox until live PSP keys + adapter exist (G-202).
 */
export class SandboxPaymentAdapter implements PaymentAdapter {
  async charge(input: ChargeInput): Promise<ChargeResult> {
    return {
      status: 'succeeded',
      method: input.method ?? 'sandbox',
      amountCents: input.amountCents,
      reference: `sandbox-${input.invoiceId.slice(0, 8)}`,
    };
  }
}

/**
 * Fail-closed stub when operators set PROVIDER_MODE=live but no live PSP client exists.
 */
export class UnimplementedLivePaymentAdapter implements PaymentAdapter {
  async charge(input: ChargeInput): Promise<ChargeResult> {
    return {
      status: 'failed',
      method: input.method ?? 'card',
      amountCents: input.amountCents,
      reference: `live-psp-unimplemented-refused-${input.invoiceId.slice(0, 8)}`,
    };
  }
}

/** Env-driven payment adapter — refuse silent live success (W2-INT-03). */
export function createPaymentAdapterFromEnv(
  env: Record<string, string | undefined> = process.env,
): PaymentAdapter {
  if (env.PROVIDER_MODE === 'live') {
    return new UnimplementedLivePaymentAdapter();
  }
  return new SandboxPaymentAdapter();
}
