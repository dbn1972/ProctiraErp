import { describe, it, expect } from 'vitest';

import {
  PrismaClient,
  Prisma,
  BoardType,
  EnrollmentStatus,
  createPrismaClient,
  getPrismaClient,
  disconnectPrisma,
} from './index';

describe('@proctira/database exports', () => {
  it('exports PrismaClient constructor', () => {
    expect(PrismaClient).toBeDefined();
    expect(typeof PrismaClient).toBe('function');
  });

  it('exports Prisma namespace with model metadata', () => {
    expect(Prisma).toBeDefined();
    expect(Prisma.ModelName).toBeDefined();
    // Verify all core models are present
    expect(Prisma.ModelName.Tenant).toBe('Tenant');
    expect(Prisma.ModelName.GeographicArea).toBe('GeographicArea');
    expect(Prisma.ModelName.Board).toBe('Board');
    expect(Prisma.ModelName.Institution).toBe('Institution');
    expect(Prisma.ModelName.Student).toBe('Student');
    expect(Prisma.ModelName.Staff).toBe('Staff');
    expect(Prisma.ModelName.Enrollment).toBe('Enrollment');
    expect(Prisma.ModelName.AcademicPeriod).toBe('AcademicPeriod');
    expect(Prisma.ModelName.Grade).toBe('Grade');
    expect(Prisma.ModelName.Class).toBe('Class');
  });

  it('exports BoardType enum with correct values', () => {
    expect(BoardType.NATIONAL).toBe('NATIONAL');
    expect(BoardType.STATE).toBe('STATE');
    expect(BoardType.PRIVATE).toBe('PRIVATE');
  });

  it('exports EnrollmentStatus enum with correct values', () => {
    expect(EnrollmentStatus.ENROLLED).toBe('ENROLLED');
    expect(EnrollmentStatus.TRANSFERRED).toBe('TRANSFERRED');
    expect(EnrollmentStatus.WITHDRAWN).toBe('WITHDRAWN');
    expect(EnrollmentStatus.GRADUATED).toBe('GRADUATED');
  });

  it('exports createPrismaClient factory function', () => {
    expect(createPrismaClient).toBeDefined();
    expect(typeof createPrismaClient).toBe('function');
  });

  it('exports getPrismaClient function', () => {
    expect(getPrismaClient).toBeDefined();
    expect(typeof getPrismaClient).toBe('function');
  });

  it('exports disconnectPrisma function', () => {
    expect(disconnectPrisma).toBeDefined();
    expect(typeof disconnectPrisma).toBe('function');
  });

  it('Prisma namespace includes DMMF with all scalar fields', () => {
    // Verify the schema includes expected fields via Prisma's generated types
    const tenantFields = Prisma.TenantScalarFieldEnum;
    expect(tenantFields.id).toBe('id');
    expect(tenantFields.name).toBe('name');
    expect(tenantFields.slug).toBe('slug');
    expect(tenantFields.config).toBe('config');
    expect(tenantFields.status).toBe('status');
    expect(tenantFields.createdAt).toBe('createdAt');
    expect(tenantFields.updatedAt).toBe('updatedAt');
    expect(tenantFields.deletedAt).toBe('deletedAt');
  });

  it('Student model includes soft delete and custom data fields', () => {
    const studentFields = Prisma.StudentScalarFieldEnum;
    expect(studentFields.deletedAt).toBe('deletedAt');
    expect(studentFields.customData).toBe('customData');
    expect(studentFields.tenantId).toBe('tenantId');
    // searchVector uses Unsupported("tsvector") so it's not in scalar enum
    // but it exists in the schema (validated by prisma validate)
  });

  it('Staff model includes soft delete and custom data fields', () => {
    const staffFields = Prisma.StaffScalarFieldEnum;
    expect(staffFields.deletedAt).toBe('deletedAt');
    expect(staffFields.customData).toBe('customData');
    expect(staffFields.tenantId).toBe('tenantId');
    // searchVector uses Unsupported("tsvector") so it's not in scalar enum
    // but it exists in the schema (validated by prisma validate)
  });

  it('Institution model includes custom data and soft delete', () => {
    const institutionFields = Prisma.InstitutionScalarFieldEnum;
    expect(institutionFields.customData).toBe('customData');
    expect(institutionFields.deletedAt).toBe('deletedAt');
    expect(institutionFields.tenantId).toBe('tenantId');
  });

  it('all tenant-scoped models have tenantId field', () => {
    const models = [
      Prisma.GeographicAreaScalarFieldEnum,
      Prisma.BoardScalarFieldEnum,
      Prisma.InstitutionScalarFieldEnum,
      Prisma.StudentScalarFieldEnum,
      Prisma.StaffScalarFieldEnum,
      Prisma.EnrollmentScalarFieldEnum,
      Prisma.AcademicPeriodScalarFieldEnum,
      Prisma.GradeScalarFieldEnum,
      Prisma.ClassScalarFieldEnum,
    ];

    for (const model of models) {
      expect(model.tenantId).toBe('tenantId');
    }
  });
});
