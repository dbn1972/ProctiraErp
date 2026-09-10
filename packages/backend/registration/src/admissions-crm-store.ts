/**
 * Admissions CRM store — waitlist + interview slots.
 *
 * `AdmissionsCrmStore` is the async contract used by RegistrationService.
 * `InMemoryAdmissionsCrmStore` backs unit tests / no-database dev;
 * `PgAdmissionsCrmStore` (see pg-admissions-crm-store.ts) persists to the
 * `admission_waitlist_entries` / `admission_interview_*` tables from
 * db/sql/014_admissions_crm_schema.sql under RLS (G-717).
 */
import { v4 as uuidv4 } from 'uuid';

export interface WaitlistEntry {
  id: string;
  tenantId: string;
  applicationId: string;
  institutionId: string;
  position: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InterviewSlot {
  id: string;
  tenantId: string;
  institutionId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  location: string | null;
  status: 'open' | 'closed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

export interface InterviewBooking {
  id: string;
  tenantId: string;
  slotId: string;
  applicationId: string;
  status: 'booked' | 'cancelled' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueWaitlistInput {
  tenantId: string;
  applicationId: string;
  institutionId: string;
  notes?: string | null;
}

export interface CreateSlotInput {
  tenantId: string;
  institutionId: string;
  startsAt: string;
  endsAt: string;
  capacity?: number;
  location?: string | null;
}

export interface BookSlotInput {
  tenantId: string;
  slotId: string;
  applicationId: string;
}

export interface AdmissionsCrmStore {
  listWaitlist(tenantId: string, institutionId?: string): Promise<WaitlistEntry[]>;
  enqueueWaitlist(input: EnqueueWaitlistInput): Promise<WaitlistEntry>;
  createSlot(input: CreateSlotInput): Promise<InterviewSlot>;
  listSlots(tenantId: string, institutionId?: string): Promise<InterviewSlot[]>;
  findSlot(id: string, tenantId: string): Promise<InterviewSlot | null>;
  listBookingsForSlot(tenantId: string, slotId: string): Promise<InterviewBooking[]>;
  bookSlot(input: BookSlotInput): Promise<InterviewBooking>;
  listBookingsForApplication(tenantId: string, applicationId: string): Promise<InterviewBooking[]>;
}

export class InMemoryAdmissionsCrmStore implements AdmissionsCrmStore {
  private waitlist: WaitlistEntry[] = [];
  private slots: InterviewSlot[] = [];
  private bookings: InterviewBooking[] = [];

  async listWaitlist(tenantId: string, institutionId?: string): Promise<WaitlistEntry[]> {
    return this.waitlist
      .filter(
        (row) =>
          row.tenantId === tenantId && (institutionId ? row.institutionId === institutionId : true),
      )
      .sort((a, b) => a.position - b.position);
  }

  async enqueueWaitlist(input: EnqueueWaitlistInput): Promise<WaitlistEntry> {
    const existing = this.waitlist.find(
      (row) => row.tenantId === input.tenantId && row.applicationId === input.applicationId,
    );
    if (existing) return existing;

    const peers = this.waitlist.filter(
      (row) => row.tenantId === input.tenantId && row.institutionId === input.institutionId,
    );
    const position = peers.reduce((max, row) => Math.max(max, row.position), 0) + 1;
    const now = new Date();
    const entry: WaitlistEntry = {
      id: uuidv4(),
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      institutionId: input.institutionId,
      position,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.waitlist.push(entry);
    return entry;
  }

  async createSlot(input: CreateSlotInput): Promise<InterviewSlot> {
    const now = new Date();
    const slot: InterviewSlot = {
      id: uuidv4(),
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      capacity: input.capacity ?? 1,
      location: input.location ?? null,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    this.slots.push(slot);
    return slot;
  }

  async listSlots(tenantId: string, institutionId?: string): Promise<InterviewSlot[]> {
    return this.slots
      .filter(
        (row) =>
          row.tenantId === tenantId && (institutionId ? row.institutionId === institutionId : true),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async findSlot(id: string, tenantId: string): Promise<InterviewSlot | null> {
    return this.slots.find((row) => row.id === id && row.tenantId === tenantId) ?? null;
  }

  async listBookingsForSlot(tenantId: string, slotId: string): Promise<InterviewBooking[]> {
    return this.bookings.filter(
      (row) => row.tenantId === tenantId && row.slotId === slotId && row.status === 'booked',
    );
  }

  async bookSlot(input: BookSlotInput): Promise<InterviewBooking> {
    const now = new Date();
    const booking: InterviewBooking = {
      id: uuidv4(),
      tenantId: input.tenantId,
      slotId: input.slotId,
      applicationId: input.applicationId,
      status: 'booked',
      createdAt: now,
      updatedAt: now,
    };
    this.bookings.push(booking);
    return booking;
  }

  async listBookingsForApplication(
    tenantId: string,
    applicationId: string,
  ): Promise<InterviewBooking[]> {
    return this.bookings.filter(
      (row) => row.tenantId === tenantId && row.applicationId === applicationId,
    );
  }
}
