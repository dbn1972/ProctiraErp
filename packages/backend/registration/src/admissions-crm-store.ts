/**
 * Admissions CRM store — waitlist + interview slots (in-memory v1).
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

export class InMemoryAdmissionsCrmStore {
  private waitlist: WaitlistEntry[] = [];
  private slots: InterviewSlot[] = [];
  private bookings: InterviewBooking[] = [];

  listWaitlist(tenantId: string, institutionId?: string): WaitlistEntry[] {
    return this.waitlist
      .filter(
        (row) =>
          row.tenantId === tenantId && (institutionId ? row.institutionId === institutionId : true),
      )
      .sort((a, b) => a.position - b.position);
  }

  enqueueWaitlist(input: {
    tenantId: string;
    applicationId: string;
    institutionId: string;
    notes?: string | null;
  }): WaitlistEntry {
    const existing = this.waitlist.find(
      (row) => row.tenantId === input.tenantId && row.applicationId === input.applicationId,
    );
    if (existing) return existing;

    const peers = this.waitlist.filter(
      (row) => row.tenantId === input.tenantId && row.institutionId === input.institutionId,
    );
    const position = peers.length + 1;
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

  createSlot(input: {
    tenantId: string;
    institutionId: string;
    startsAt: string;
    endsAt: string;
    capacity?: number;
    location?: string | null;
  }): InterviewSlot {
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

  listSlots(tenantId: string, institutionId?: string): InterviewSlot[] {
    return this.slots
      .filter(
        (row) =>
          row.tenantId === tenantId && (institutionId ? row.institutionId === institutionId : true),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  findSlot(id: string, tenantId: string): InterviewSlot | null {
    return this.slots.find((row) => row.id === id && row.tenantId === tenantId) ?? null;
  }

  listBookingsForSlot(tenantId: string, slotId: string): InterviewBooking[] {
    return this.bookings.filter(
      (row) => row.tenantId === tenantId && row.slotId === slotId && row.status === 'booked',
    );
  }

  bookSlot(input: { tenantId: string; slotId: string; applicationId: string }): InterviewBooking {
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

  listBookingsForApplication(tenantId: string, applicationId: string): InterviewBooking[] {
    return this.bookings.filter(
      (row) => row.tenantId === tenantId && row.applicationId === applicationId,
    );
  }
}
