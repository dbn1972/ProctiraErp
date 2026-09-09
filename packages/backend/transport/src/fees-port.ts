/**
 * G-920 — port for posting transport fee lines onto the G-903 fees ledger.
 *
 * Implemented by api-gateway via `@proctira/backend-fees` FeesService so
 * `@proctira/backend-transport` does not take a hard fees package dependency.
 *
 * Honesty: FeesService.createInvoice does not accept structureId. When
 * bulkInvoiceClass is available we use it so the invoice is structure-linked;
 * otherwise we post a titled invoice (or record a pending transport_fee_links row).
 */
export interface TransportFeeStructureInput {
  name: string;
  category: string;
  amountCents: number;
  currency?: string;
}

export interface TransportFeeInvoiceInput {
  studentId: string;
  title: string;
  description?: string;
  amountCents: number;
  currency?: string;
}

export interface TransportFeesPort {
  createFeeStructure(
    tenantId: string,
    actorId: string,
    input: TransportFeeStructureInput,
  ): Promise<{ id: string }>;
  createInvoice(
    tenantId: string,
    actorId: string,
    input: TransportFeeInvoiceInput,
  ): Promise<{ id: string }>;
  bulkInvoiceClass?(
    tenantId: string,
    actorId: string,
    input: { structureId: string; studentIds: string[] },
  ): Promise<{ created: Array<{ id: string }>; skipped: string[] }>;
}
