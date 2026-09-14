/**
 * In-Memory Student Repository
 *
 * Used for unit testing the import service without database dependencies.
 */

import { v4 as uuidv4 } from 'uuid';

import type { StudentRecord, StudentRepository } from './types.js';

export class InMemoryStudentRepository implements StudentRepository {
  private students: StudentRecord[] = [];

  async findById(tenantId: string, id: string): Promise<StudentRecord | null> {
    return this.students.find((s) => s.id === id && s.tenantId === tenantId) ?? null;
  }

  async findByNationalId(tenantId: string, nationalId: string): Promise<StudentRecord | null> {
    const normalized = nationalId.trim().toLowerCase();
    return (
      this.students.find(
        (s) =>
          s.tenantId === tenantId &&
          s.nationalId !== null &&
          s.nationalId.trim().toLowerCase() === normalized,
      ) ?? null
    );
  }

  async findByNameAndDob(
    tenantId: string,
    firstName: string,
    lastName: string,
    dateOfBirth: string,
  ): Promise<StudentRecord[]> {
    const normalizedFirst = firstName.trim().toLowerCase();
    const normalizedLast = lastName.trim().toLowerCase();
    return this.students.filter(
      (s) =>
        s.tenantId === tenantId &&
        s.firstName.trim().toLowerCase() === normalizedFirst &&
        s.lastName.trim().toLowerCase() === normalizedLast &&
        s.dateOfBirth === dateOfBirth,
    );
  }

  async create(
    tenantId: string,
    data: Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<StudentRecord> {
    const record: StudentRecord = {
      id: uuidv4(),
      tenantId,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.students.push(record);
    return record;
  }

  async update(
    tenantId: string,
    id: string,
    data: Partial<Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<StudentRecord> {
    const idx = this.students.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (idx === -1) {
      throw new Error(`Student with id '${id}' not found in tenant '${tenantId}'`);
    }
    const existing = this.students[idx]!;
    const updated: StudentRecord = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.students[idx] = updated;
    return updated;
  }


  async delete(tenantId: string, id: string): Promise<boolean> {
    const idx = this.students.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (idx === -1) return false;
    this.students.splice(idx, 1);
    return true;
  }

  async nationalIdExists(tenantId: string, nationalId: string): Promise<boolean> {
    const result = await this.findByNationalId(tenantId, nationalId);
    return result !== null;
  }

  /** Helper: get all students (for test assertions) */
  getAll(): StudentRecord[] {
    return [...this.students];
  }

  /** Helper: seed existing students (for test setup) */
  seed(records: StudentRecord[]): void {
    this.students.push(...records);
  }

  /** Helper: clear all records */
  clear(): void {
    this.students = [];
  }
}
