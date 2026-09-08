/**
 * Adapts the core {@link CoreStudentRepository} (Prisma / in-memory, RLS-safe)
 * to the flat {@link ImportStudentRepository} contract the bulk importer uses,
 * so `/students/import` writes land in the same store as `/students` (G-701).
 */
import { randomUUID } from 'node:crypto';

import type {
  StudentEntity,
  StudentRepository as CoreStudentRepository,
} from '../student-repository.js';

import type { StudentRecord, StudentRepository as ImportStudentRepository } from './types.js';

function primaryContact(entity: StudentEntity, type: string): string | null {
  const contacts = entity.contacts.filter((c) => c.type === type);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  return primary?.value ?? null;
}

function toRecord(entity: StudentEntity): StudentRecord {
  const guardian = entity.guardians[0];
  const customData = entity.customData ?? {};
  const rawInstitutionCode = customData['institutionCode'];
  const institutionCode = typeof rawInstitutionCode === 'string' ? rawInstitutionCode : null;
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    firstName: entity.firstName,
    lastName: entity.lastName,
    dateOfBirth: entity.dateOfBirth,
    gender: entity.gender || null,
    nationalId: entity.nationalId,
    nationality: entity.nationality,
    contactPhone: primaryContact(entity, 'phone'),
    contactEmail: primaryContact(entity, 'email'),
    guardianName: guardian ? `${guardian.firstName} ${guardian.lastName}`.trim() : null,
    guardianPhone: guardian?.contactPhone ?? null,
    institutionCode,
    customData: Object.keys(customData).length > 0 ? customData : null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() ?? '';
  return { firstName, lastName: parts.join(' ') };
}

type RecordInput = Partial<Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>;

function toEntityPatch(data: RecordInput): Partial<StudentEntity> {
  const patch: Partial<StudentEntity> = {};
  if (data.firstName !== undefined) patch.firstName = data.firstName;
  if (data.lastName !== undefined) patch.lastName = data.lastName;
  if (data.dateOfBirth !== undefined) patch.dateOfBirth = data.dateOfBirth;
  if (data.gender !== undefined) patch.gender = data.gender ?? '';
  if (data.nationalId !== undefined) patch.nationalId = data.nationalId;
  if (data.nationality !== undefined) patch.nationality = data.nationality;

  const contacts: StudentEntity['contacts'] = [];
  if (data.contactPhone)
    contacts.push({ type: 'phone', value: data.contactPhone, isPrimary: true });
  if (data.contactEmail)
    contacts.push({ type: 'email', value: data.contactEmail, isPrimary: true });
  if (contacts.length > 0) patch.contacts = contacts;

  if (data.guardianName) {
    const { firstName, lastName } = splitName(data.guardianName);
    patch.guardians = [
      {
        id: randomUUID(),
        firstName,
        lastName,
        relationship: 'guardian',
        ...(data.guardianPhone ? { contactPhone: data.guardianPhone } : {}),
      },
    ];
  }

  const customData: Record<string, unknown> = { ...(data.customData ?? {}) };
  if (data.institutionCode) customData['institutionCode'] = data.institutionCode;
  if (Object.keys(customData).length > 0 || data.customData !== undefined) {
    patch.customData = customData;
  }
  return patch;
}

export class CoreRepositoryImportAdapter implements ImportStudentRepository {
  constructor(private readonly core: CoreStudentRepository) {}

  async findByNationalId(tenantId: string, nationalId: string): Promise<StudentRecord | null> {
    const entity = await this.core.findByNationalId(nationalId, tenantId);
    return entity ? toRecord(entity) : null;
  }

  async findByNameAndDob(
    tenantId: string,
    firstName: string,
    lastName: string,
    dateOfBirth: string,
  ): Promise<StudentRecord[]> {
    const first = firstName.trim().toLowerCase();
    const last = lastName.trim().toLowerCase();
    const page = await this.core.search(tenantId, `${firstName} ${lastName}`.trim(), {
      page: 1,
      pageSize: 100,
    });
    return page.data
      .filter(
        (s) =>
          s.firstName.trim().toLowerCase() === first &&
          s.lastName.trim().toLowerCase() === last &&
          s.dateOfBirth === dateOfBirth,
      )
      .map(toRecord);
  }

  async create(
    tenantId: string,
    data: Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<StudentRecord> {
    const patch = toEntityPatch(data);
    const entity = await this.core.create({
      id: randomUUID(),
      tenantId,
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender ?? '',
      nationalId: data.nationalId,
      nationality: data.nationality,
      contacts: patch.contacts ?? [],
      guardians: patch.guardians ?? [],
      identityDocuments: [],
      customData: patch.customData ?? {},
    });
    return toRecord(entity);
  }

  async update(tenantId: string, id: string, data: RecordInput): Promise<StudentRecord> {
    const entity = await this.core.update(id, tenantId, toEntityPatch(data));
    if (!entity) {
      throw new Error(`Student with id '${id}' not found in tenant '${tenantId}'`);
    }
    return toRecord(entity);
  }

  async nationalIdExists(tenantId: string, nationalId: string): Promise<boolean> {
    return (await this.findByNationalId(tenantId, nationalId)) !== null;
  }
}
