/**
 * Duck-typed admissions offer port for parent/guardian offer-pay (A2).
 * Gateway injects AdmissionsPipelineService methods — no hard package cycle.
 */
export interface ParentAdmissionOffer {
  id: string;
  applicationId: string;
  status: string;
  feeAmount: number;
  feeCurrency: string;
  paymentRef: string | null;
  offerFeeInvoiceId: string | null;
  enrolledStudentId: string | null;
  expiresAt: string | null;
  applicantFirstName: string;
  applicantLastName: string;
  guardianEmail: string | null;
}

export interface AdmissionsOffersPort {
  listGuardianOffers(tenantId: string, guardianEmail: string): Promise<ParentAdmissionOffer[]>;
  acceptOfferForGuardian(
    tenantId: string,
    offerId: string,
    guardianEmail: string,
    input: { paymentRef: string; offerFeeInvoiceId?: string },
  ): Promise<ParentAdmissionOffer>;
}
