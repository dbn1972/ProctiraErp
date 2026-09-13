/**
 * W2-REC-01: lifecycle certificate issuance (bonafide / transfer / character / leaving).
 */

export type LifecycleCertificateType =
  | 'bonafide'
  | 'transfer'
  | 'character'
  | 'leaving';

export type LifecycleCertificateStatus = 'issued' | 'revoked';

export interface LifecycleCertificate {
  id: string;
  tenantId: string;
  studentId: string;
  type: LifecycleCertificateType;
  /** Stable public serial for verification (tenant-scoped unique). */
  serialNumber: string;
  status: LifecycleCertificateStatus;
  issuedBy: string;
  issuedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  academicYear: string | null;
  remarks: string | null;
  /** Deterministic payload hash for tamper-evidence of printed content. */
  checksum: string;
}

export interface IssueLifecycleCertificateInput {
  studentId: string;
  type: LifecycleCertificateType;
  academicYear?: string | null;
  remarks?: string | null;
}

export interface LifecycleCertificateRepository {
  create(entity: LifecycleCertificate): Promise<LifecycleCertificate>;
  findById(tenantId: string, id: string): Promise<LifecycleCertificate | null>;
  findBySerial(tenantId: string, serialNumber: string): Promise<LifecycleCertificate | null>;
  listByStudent(tenantId: string, studentId: string): Promise<LifecycleCertificate[]>;
  update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<LifecycleCertificate, 'status' | 'revokedAt' | 'revokeReason'>>,
  ): Promise<LifecycleCertificate | null>;
}
