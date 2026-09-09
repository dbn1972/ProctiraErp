import { v4 as uuidv4 } from 'uuid';

import type { EnquirySource, EnquiryStage, FollowupStatus, OfferStatus } from './schemas.js';

export interface EnquiryRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  institutionName: string | null;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  source: EnquirySource;
  stage: EnquiryStage;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  interviewScore: number | null;
  testScore: number | null;
  applicationId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowupRecord {
  id: string;
  tenantId: string;
  enquiryId: string;
  dueAt: Date;
  ownerId: string | null;
  notes: string;
  status: FollowupStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeatMatrixRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  seats: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationPlacement {
  applicationId: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  interviewScore: number;
  testScore: number;
  firstName: string;
  lastName: string;
  submittedAt: Date;
}

export interface MeritListRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  interviewWeight: number;
  testWeight: number;
  weightsSnapshot: { interview: number; test: number };
  generatedAt: Date;
}

export interface MeritListEntryRecord {
  id: string;
  tenantId: string;
  meritListId: string;
  applicationId: string;
  rank: number;
  score: number;
  interviewScore: number;
  testScore: number;
  weightsSnapshot: { interview: number; test: number };
}

export interface OfferRecord {
  id: string;
  tenantId: string;
  applicationId: string;
  meritListId: string | null;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  status: OfferStatus;
  feeAmount: number;
  feeCurrency: string;
  paymentRef: string | null;
  offerFeeInvoiceId: string | null;
  enrolledStudentId: string | null;
  expiresAt: Date | null;
  offerDocument: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdmissionsPipelineStore {
  createEnquiry(record: EnquiryRecord): Promise<EnquiryRecord>;
  listEnquiries(tenantId: string): Promise<EnquiryRecord[]>;
  findEnquiry(tenantId: string, id: string): Promise<EnquiryRecord | null>;
  updateEnquiry(record: EnquiryRecord): Promise<EnquiryRecord>;
  createFollowup(record: FollowupRecord): Promise<FollowupRecord>;
  listFollowups(tenantId: string, enquiryId: string): Promise<FollowupRecord[]>;

  upsertSeat(record: SeatMatrixRecord): Promise<SeatMatrixRecord>;
  listSeats(
    tenantId: string,
    filter?: { institutionId?: string; academicPeriodId?: string },
  ): Promise<SeatMatrixRecord[]>;
  findSeat(
    tenantId: string,
    key: { institutionId: string; academicPeriodId: string; gradeId: string; quota: string },
  ): Promise<SeatMatrixRecord | null>;

  upsertPlacement(placement: ApplicationPlacement): Promise<ApplicationPlacement>;
  getPlacement(tenantId: string, applicationId: string): Promise<ApplicationPlacement | null>;
  listPlacements(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId: string; gradeId: string },
  ): Promise<ApplicationPlacement[]>;

  replaceMeritList(
    list: MeritListRecord,
    entries: MeritListEntryRecord[],
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] }>;
  findMeritList(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId: string; gradeId: string },
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] } | null>;
  findMeritListById(
    tenantId: string,
    id: string,
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] } | null>;

  createOffer(record: OfferRecord): Promise<OfferRecord>;
  findOffer(tenantId: string, id: string): Promise<OfferRecord | null>;
  listOffers(tenantId: string, applicationId?: string): Promise<OfferRecord[]>;
  updateOffer(record: OfferRecord): Promise<OfferRecord>;
  countAcceptedSeats(
    tenantId: string,
    key: { institutionId: string; academicPeriodId: string; gradeId: string; quota: string },
  ): Promise<number>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryAdmissionsPipelineStore implements AdmissionsPipelineStore {
  private enquiries = new Map<string, EnquiryRecord>();
  private followups = new Map<string, FollowupRecord>();
  private seats = new Map<string, SeatMatrixRecord>();
  private placements = new Map<string, ApplicationPlacement>();
  private meritLists = new Map<string, MeritListRecord>();
  private meritEntries = new Map<string, MeritListEntryRecord[]>();
  private offers = new Map<string, OfferRecord>();

  async createEnquiry(record: EnquiryRecord): Promise<EnquiryRecord> {
    this.enquiries.set(record.id, clone(record));
    return clone(record);
  }

  async listEnquiries(tenantId: string): Promise<EnquiryRecord[]> {
    return [...this.enquiries.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }

  async findEnquiry(tenantId: string, id: string): Promise<EnquiryRecord | null> {
    const row = this.enquiries.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async updateEnquiry(record: EnquiryRecord): Promise<EnquiryRecord> {
    this.enquiries.set(record.id, clone(record));
    return clone(record);
  }

  async createFollowup(record: FollowupRecord): Promise<FollowupRecord> {
    this.followups.set(record.id, clone(record));
    return clone(record);
  }

  async listFollowups(tenantId: string, enquiryId: string): Promise<FollowupRecord[]> {
    return [...this.followups.values()]
      .filter((row) => row.tenantId === tenantId && row.enquiryId === enquiryId)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map(clone);
  }

  private seatKey(row: {
    tenantId: string;
    institutionId: string;
    academicPeriodId: string;
    gradeId: string;
    quota: string;
  }): string {
    return `${row.tenantId}:${row.institutionId}:${row.academicPeriodId}:${row.gradeId}:${row.quota}`;
  }

  async upsertSeat(record: SeatMatrixRecord): Promise<SeatMatrixRecord> {
    const key = this.seatKey(record);
    const existing = [...this.seats.values()].find((row) => this.seatKey(row) === key);
    const next = existing
      ? { ...existing, seats: record.seats, updatedAt: record.updatedAt }
      : record;
    this.seats.set(next.id, clone(next));
    if (existing && existing.id !== next.id) this.seats.delete(existing.id);
    return clone(next);
  }

  async listSeats(
    tenantId: string,
    filter?: { institutionId?: string; academicPeriodId?: string },
  ): Promise<SeatMatrixRecord[]> {
    return [...this.seats.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          (!filter?.institutionId || row.institutionId === filter.institutionId) &&
          (!filter?.academicPeriodId || row.academicPeriodId === filter.academicPeriodId),
      )
      .sort((a, b) => a.quota.localeCompare(b.quota) || a.gradeId.localeCompare(b.gradeId))
      .map(clone);
  }

  async findSeat(
    tenantId: string,
    key: { institutionId: string; academicPeriodId: string; gradeId: string; quota: string },
  ): Promise<SeatMatrixRecord | null> {
    const found = [...this.seats.values()].find(
      (row) =>
        row.tenantId === tenantId &&
        row.institutionId === key.institutionId &&
        row.academicPeriodId === key.academicPeriodId &&
        row.gradeId === key.gradeId &&
        row.quota === key.quota,
    );
    return found ? clone(found) : null;
  }

  async upsertPlacement(placement: ApplicationPlacement): Promise<ApplicationPlacement> {
    this.placements.set(`${placement.tenantId}:${placement.applicationId}`, clone(placement));
    return clone(placement);
  }

  async getPlacement(
    tenantId: string,
    applicationId: string,
  ): Promise<ApplicationPlacement | null> {
    const row = this.placements.get(`${tenantId}:${applicationId}`);
    return row ? clone(row) : null;
  }

  async listPlacements(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId: string; gradeId: string },
  ): Promise<ApplicationPlacement[]> {
    return [...this.placements.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.institutionId === filter.institutionId &&
          row.academicPeriodId === filter.academicPeriodId &&
          row.gradeId === filter.gradeId,
      )
      .map(clone);
  }

  async replaceMeritList(
    list: MeritListRecord,
    entries: MeritListEntryRecord[],
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] }> {
    const existing = [...this.meritLists.values()].find(
      (row) =>
        row.tenantId === list.tenantId &&
        row.institutionId === list.institutionId &&
        row.academicPeriodId === list.academicPeriodId &&
        row.gradeId === list.gradeId,
    );
    const next = existing ? { ...list, id: existing.id } : list;
    if (existing) this.meritEntries.delete(existing.id);
    this.meritLists.set(next.id, clone(next));
    const remapped = entries.map((entry) => ({ ...entry, meritListId: next.id }));
    this.meritEntries.set(next.id, remapped.map(clone));
    return { list: clone(next), entries: remapped.map(clone) };
  }

  async findMeritList(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId: string; gradeId: string },
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] } | null> {
    const list = [...this.meritLists.values()].find(
      (row) =>
        row.tenantId === tenantId &&
        row.institutionId === filter.institutionId &&
        row.academicPeriodId === filter.academicPeriodId &&
        row.gradeId === filter.gradeId,
    );
    if (!list) return null;
    return {
      list: clone(list),
      entries: (this.meritEntries.get(list.id) ?? []).map(clone),
    };
  }

  async findMeritListById(
    tenantId: string,
    id: string,
  ): Promise<{ list: MeritListRecord; entries: MeritListEntryRecord[] } | null> {
    const list = this.meritLists.get(id);
    if (!list || list.tenantId !== tenantId) return null;
    return { list: clone(list), entries: (this.meritEntries.get(id) ?? []).map(clone) };
  }

  async createOffer(record: OfferRecord): Promise<OfferRecord> {
    this.offers.set(record.id, clone(record));
    return clone(record);
  }

  async findOffer(tenantId: string, id: string): Promise<OfferRecord | null> {
    const row = this.offers.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async listOffers(tenantId: string, applicationId?: string): Promise<OfferRecord[]> {
    return [...this.offers.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId && (!applicationId || row.applicationId === applicationId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }

  async updateOffer(record: OfferRecord): Promise<OfferRecord> {
    this.offers.set(record.id, clone(record));
    return clone(record);
  }

  async countAcceptedSeats(
    tenantId: string,
    key: { institutionId: string; academicPeriodId: string; gradeId: string; quota: string },
  ): Promise<number> {
    return [...this.offers.values()].filter(
      (row) =>
        row.tenantId === tenantId &&
        row.status === 'accepted' &&
        row.institutionId === key.institutionId &&
        row.academicPeriodId === key.academicPeriodId &&
        row.gradeId === key.gradeId &&
        row.quota === key.quota,
    ).length;
  }
}

export function newEnquiryId(): string {
  return uuidv4();
}
