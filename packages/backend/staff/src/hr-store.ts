/**
 * G-918 staff HR persistence: contracts, qualifications, daily attendance.
 * In-memory map for unit tests / no DATABASE_URL; Postgres via pg-hr-ops-store.
 */
export type StaffContractType = 'permanent' | 'probation' | 'fixed_term' | 'visiting' | 'intern';
export type StaffContractStatus = 'draft' | 'active' | 'expired' | 'terminated';
export type StaffAttendanceStatus = 'present' | 'absent' | 'leave' | 'half_day';

export interface StaffContractRecord {
  id: string;
  tenantId: string;
  staffId: string;
  contractType: StaffContractType;
  startDate: string;
  endDate: string | null;
  salaryBand: string;
  status: StaffContractStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffQualificationRecord {
  id: string;
  tenantId: string;
  staffId: string;
  degree: string;
  institution: string;
  year: number;
  verified: boolean;
  documentRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffAttendanceRecord {
  id: string;
  tenantId: string;
  staffId: string;
  date: string;
  status: StaffAttendanceStatus;
  notes: string | null;
  markedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffHrStore {
  createContract(record: StaffContractRecord): Promise<StaffContractRecord>;
  listContracts(tenantId: string, staffId?: string): Promise<StaffContractRecord[]>;
  findContract(tenantId: string, id: string): Promise<StaffContractRecord | null>;
  updateContract(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        StaffContractRecord,
        'contractType' | 'startDate' | 'endDate' | 'salaryBand' | 'status' | 'notes'
      >
    >,
  ): Promise<StaffContractRecord | null>;

  createQualification(record: StaffQualificationRecord): Promise<StaffQualificationRecord>;
  listQualifications(tenantId: string, staffId?: string): Promise<StaffQualificationRecord[]>;
  findQualification(tenantId: string, id: string): Promise<StaffQualificationRecord | null>;
  updateQualification(
    tenantId: string,
    id: string,
    patch: Partial<Pick<StaffQualificationRecord, 'verified' | 'documentRef'>>,
  ): Promise<StaffQualificationRecord | null>;

  upsertAttendance(record: StaffAttendanceRecord): Promise<StaffAttendanceRecord>;
  listAttendance(
    tenantId: string,
    filter: { date?: string; staffId?: string; from?: string; to?: string },
  ): Promise<StaffAttendanceRecord[]>;
  findAttendance(
    tenantId: string,
    staffId: string,
    date: string,
  ): Promise<StaffAttendanceRecord | null>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryStaffHrStore implements StaffHrStore {
  private readonly contracts = new Map<string, StaffContractRecord>();
  private readonly qualifications = new Map<string, StaffQualificationRecord>();
  private readonly attendance = new Map<string, StaffAttendanceRecord>();

  private attendanceKey(tenantId: string, staffId: string, date: string): string {
    return `${tenantId}:${staffId}:${date}`;
  }

  async createContract(record: StaffContractRecord): Promise<StaffContractRecord> {
    this.contracts.set(record.id, clone(record));
    return clone(record);
  }

  async listContracts(tenantId: string, staffId?: string): Promise<StaffContractRecord[]> {
    return [...this.contracts.values()]
      .filter((row) => row.tenantId === tenantId && (!staffId || row.staffId === staffId))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((row) => clone(row));
  }

  async findContract(tenantId: string, id: string): Promise<StaffContractRecord | null> {
    const row = this.contracts.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async updateContract(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        StaffContractRecord,
        'contractType' | 'startDate' | 'endDate' | 'salaryBand' | 'status' | 'notes'
      >
    >,
  ): Promise<StaffContractRecord | null> {
    const row = this.contracts.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    const updated: StaffContractRecord = { ...row, ...patch, updatedAt: new Date() };
    this.contracts.set(id, updated);
    return clone(updated);
  }

  async createQualification(record: StaffQualificationRecord): Promise<StaffQualificationRecord> {
    this.qualifications.set(record.id, clone(record));
    return clone(record);
  }

  async listQualifications(
    tenantId: string,
    staffId?: string,
  ): Promise<StaffQualificationRecord[]> {
    return [...this.qualifications.values()]
      .filter((row) => row.tenantId === tenantId && (!staffId || row.staffId === staffId))
      .sort((a, b) => b.year - a.year)
      .map((row) => clone(row));
  }

  async findQualification(
    tenantId: string,
    id: string,
  ): Promise<StaffQualificationRecord | null> {
    const row = this.qualifications.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async updateQualification(
    tenantId: string,
    id: string,
    patch: Partial<Pick<StaffQualificationRecord, 'verified' | 'documentRef'>>,
  ): Promise<StaffQualificationRecord | null> {
    const row = this.qualifications.get(id);
    if (!row || row.tenantId !== tenantId) return null;
    const updated: StaffQualificationRecord = { ...row, ...patch, updatedAt: new Date() };
    this.qualifications.set(id, updated);
    return clone(updated);
  }

  async upsertAttendance(record: StaffAttendanceRecord): Promise<StaffAttendanceRecord> {
    const key = this.attendanceKey(record.tenantId, record.staffId, record.date);
    const existing = [...this.attendance.values()].find(
      (row) =>
        row.tenantId === record.tenantId &&
        row.staffId === record.staffId &&
        row.date === record.date,
    );
    if (existing) {
      const updated: StaffAttendanceRecord = {
        ...existing,
        status: record.status,
        notes: record.notes,
        markedBy: record.markedBy,
        updatedAt: new Date(),
      };
      this.attendance.set(existing.id, updated);
      this.attendance.delete(key);
      return clone(updated);
    }
    this.attendance.set(record.id, clone(record));
    return clone(record);
  }

  async listAttendance(
    tenantId: string,
    filter: { date?: string; staffId?: string; from?: string; to?: string },
  ): Promise<StaffAttendanceRecord[]> {
    return [...this.attendance.values()]
      .filter((row) => {
        if (row.tenantId !== tenantId) return false;
        if (filter.staffId && row.staffId !== filter.staffId) return false;
        if (filter.date && row.date !== filter.date) return false;
        if (filter.from && row.date < filter.from) return false;
        if (filter.to && row.date > filter.to) return false;
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.staffId.localeCompare(b.staffId))
      .map((row) => clone(row));
  }

  async findAttendance(
    tenantId: string,
    staffId: string,
    date: string,
  ): Promise<StaffAttendanceRecord | null> {
    const row = [...this.attendance.values()].find(
      (item) => item.tenantId === tenantId && item.staffId === staffId && item.date === date,
    );
    return row ? clone(row) : null;
  }
}
