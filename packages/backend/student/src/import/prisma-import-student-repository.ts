/**
 * Prisma adapter for the student bulk-import {@link StudentRepository}.
 *
 * Maps the import-module's flat {@link StudentRecord} shape onto the Prisma
 * `students` table. Extra fields (nationality, contacts, guardians,
 * institutionCode) live in `custom_data.__profile` / `custom_data.__import`
 * — same envelope pattern as {@link PrismaStudentRepository}, with no
 * cross-schema FKs or SQL joins (charter §19).
 *
 * Every method runs inside {@link withTenantTransaction} for RLS.
 */
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import type { StudentRecord, StudentRepository } from './types.js';

const PROFILE_KEY = '__profile';
const IMPORT_KEY = '__import';

interface ProfileEnvelope {
  nationality: string | null;
  contacts: Array<{ type: string; value: string; isPrimary: boolean }>;
  guardians: Array<{
    id: string;
    firstName: string;
    lastName: string;
    relationship: string;
    contactPhone?: string;
    contactEmail?: string;
  }>;
  identityDocuments: unknown[];
}

interface ImportEnvelope {
  institutionCode: string | null;
}

interface StudentRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: string;
  nationalId: string | null;
  customData: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function extractEnvelopes(customData: unknown): {
  profile: ProfileEnvelope;
  importMeta: ImportEnvelope;
  userCustomData: Record<string, unknown> | null;
} {
  const raw =
    customData && typeof customData === 'object'
      ? { ...(customData as Record<string, unknown>) }
      : {};
  const rawProfile = (raw[PROFILE_KEY] ?? {}) as Partial<ProfileEnvelope>;
  const rawImport = (raw[IMPORT_KEY] ?? {}) as Partial<ImportEnvelope>;
  delete raw[PROFILE_KEY];
  delete raw[IMPORT_KEY];

  return {
    profile: {
      nationality: rawProfile.nationality ?? null,
      contacts: rawProfile.contacts ?? [],
      guardians: rawProfile.guardians ?? [],
      identityDocuments: rawProfile.identityDocuments ?? [],
    },
    importMeta: {
      institutionCode: rawImport.institutionCode ?? null,
    },
    userCustomData: Object.keys(raw).length > 0 ? raw : null,
  };
}

function buildCustomData(data: {
  nationality?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  institutionCode?: string | null;
  customData?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const contacts: ProfileEnvelope['contacts'] = [];
  if (data.contactPhone) {
    contacts.push({ type: 'phone', value: data.contactPhone, isPrimary: true });
  }
  if (data.contactEmail) {
    contacts.push({
      type: 'email',
      value: data.contactEmail,
      isPrimary: contacts.length === 0,
    });
  }

  const guardians: ProfileEnvelope['guardians'] = [];
  if (data.guardianName || data.guardianPhone) {
    const parts = (data.guardianName ?? 'Guardian').trim().split(/\s+/);
    const firstName = parts[0] ?? 'Guardian';
    const lastName = parts.slice(1).join(' ') || firstName;
    guardians.push({
      id: uuidv4(),
      firstName,
      lastName,
      relationship: 'guardian',
      ...(data.guardianPhone ? { contactPhone: data.guardianPhone } : {}),
    });
  }

  const profile: ProfileEnvelope = {
    nationality: data.nationality ?? null,
    contacts,
    guardians,
    identityDocuments: [],
  };

  const importMeta: ImportEnvelope = {
    institutionCode: data.institutionCode ?? null,
  };

  return {
    ...(data.customData ?? {}),
    [PROFILE_KEY]: profile,
    [IMPORT_KEY]: importMeta,
  };
}

function primaryContact(
  contacts: ProfileEnvelope['contacts'],
  type: string,
): string | null {
  const match = contacts.find((c) => c.type === type);
  return match?.value ?? null;
}

function toRecord(row: StudentRow): StudentRecord {
  const { profile, importMeta, userCustomData } = extractEnvelopes(row.customData);
  const primaryGuardian = profile.guardians[0];
  return {
    id: row.id,
    tenantId: row.tenantId,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: toIsoDate(row.dateOfBirth),
    gender: row.gender,
    nationalId: row.nationalId,
    nationality: profile.nationality,
    contactPhone: primaryContact(profile.contacts, 'phone'),
    contactEmail: primaryContact(profile.contacts, 'email'),
    guardianName: primaryGuardian
      ? `${primaryGuardian.firstName} ${primaryGuardian.lastName}`.trim()
      : null,
    guardianPhone: primaryGuardian?.contactPhone ?? null,
    institutionCode: importMeta.institutionCode,
    customData: userCustomData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prisma-backed import student repository.
 */
export class PrismaImportStudentRepository implements StudentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByNationalId(
    tenantId: string,
    nationalId: string,
  ): Promise<StudentRecord | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.student.findFirst({
        where: { tenantId, nationalId, deletedAt: null },
      })) as StudentRow | null;
      return row ? toRecord(row) : null;
    });
  }

  async findByNameAndDob(
    tenantId: string,
    firstName: string,
    lastName: string,
    dateOfBirth: string,
  ): Promise<StudentRecord[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.student.findMany({
        where: {
          tenantId,
          deletedAt: null,
          firstName: { equals: firstName.trim(), mode: 'insensitive' },
          lastName: { equals: lastName.trim(), mode: 'insensitive' },
          dateOfBirth: new Date(dateOfBirth),
        },
      })) as StudentRow[];
      return rows.map(toRecord);
    });
  }

  async create(
    tenantId: string,
    data: Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<StudentRecord> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.student.create({
        data: {
          id: uuidv4(),
          tenantId,
          firstName: data.firstName,
          lastName: data.lastName,
          dateOfBirth: new Date(data.dateOfBirth),
          gender: data.gender ?? 'Unknown',
          nationalId: data.nationalId,
          customData: buildCustomData(data) as Prisma.InputJsonValue,
        },
      })) as StudentRow;
      return toRecord(row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: Partial<Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<StudentRecord> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.student.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as StudentRow | null;
      if (!existing) {
        throw new Error(`Student with id '${id}' not found in tenant '${tenantId}'`);
      }

      const current = toRecord(existing);
      const merged = { ...current, ...data };

      const row = (await tx.student.update({
        where: { id },
        data: {
          firstName: merged.firstName,
          lastName: merged.lastName,
          dateOfBirth: new Date(merged.dateOfBirth),
          gender: merged.gender ?? 'Unknown',
          nationalId: merged.nationalId,
          customData: buildCustomData(merged) as Prisma.InputJsonValue,
        },
      })) as StudentRow;
      return toRecord(row);
    });
  }

  async nationalIdExists(tenantId: string, nationalId: string): Promise<boolean> {
    const found = await this.findByNationalId(tenantId, nationalId);
    return found !== null;
  }
}
