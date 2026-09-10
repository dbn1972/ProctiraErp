/**
 * Payment adapter interface + sandbox stub (G-202 waived for live PSP).
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
 * Always succeeds — honesty stub until live PSP keys are available (G-202 WAIVED).
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
