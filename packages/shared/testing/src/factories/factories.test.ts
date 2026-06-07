import { describe, it, expect } from 'vitest';

import {
  createTenant,
  createTenantConfig,
  createInstitution,
  createInstitutionList,
  createStudent,
  createStudentList,
  createStaff,
  createStaffList,
  createEnrollment,
  createArea,
  createAreaHierarchy,
  createAcademicPeriod,
} from './index.js';

describe('Tenant Factory', () => {
  it('creates a valid tenant with all required fields', () => {
    const tenant = createTenant();

    expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tenant.name).toBeTruthy();
    expect(tenant.slug).toBeTruthy();
    expect(tenant.domain).toContain('.proctira.org');
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.config).toBeDefined();
    expect(tenant.createdAt).toBeInstanceOf(Date);
    expect(tenant.updatedAt).toBeInstanceOf(Date);
    expect(tenant.deletedAt).toBeNull();
  });

  it('applies overrides correctly', () => {
    const tenant = createTenant({ name: 'Custom School', status: 'INACTIVE' });

    expect(tenant.name).toBe('Custom School');
    expect(tenant.status).toBe('INACTIVE');
  });

  it('creates unique tenants on each call', () => {
    const t1 = createTenant();
    const t2 = createTenant();

    expect(t1.id).not.toBe(t2.id);
  });
});

describe('TenantConfig Factory', () => {
  it('creates a valid config with defaults', () => {
    const config = createTenantConfig();

    expect(config.locale).toBe('en');
    expect(config.timezone).toBeTruthy();
    expect(config.dateFormat).toBe('YYYY-MM-DD');
    expect(config.academicYearStart).toBeGreaterThanOrEqual(1);
    expect(config.academicYearStart).toBeLessThanOrEqual(12);
    expect(config.features).toBeDefined();
  });

  it('applies overrides', () => {
    const config = createTenantConfig({ locale: 'ar', timezone: 'Asia/Kolkata' });

    expect(config.locale).toBe('ar');
    expect(config.timezone).toBe('Asia/Kolkata');
  });
});

describe('Institution Factory', () => {
  it('creates a valid institution with all required fields', () => {
    const inst = createInstitution();

    expect(inst.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inst.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(inst.name).toBeTruthy();
    expect(inst.code).toBeTruthy();
    expect(inst.areaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(inst.typeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(inst.sectorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(inst.ownershipId).toMatch(/^[0-9a-f-]{36}$/);
    expect(inst.status).toBe('ACTIVE');
    expect(inst.customData).toEqual({});
    expect(inst.createdAt).toBeInstanceOf(Date);
  });

  it('creates a list of institutions', () => {
    const list = createInstitutionList(3);

    expect(list).toHaveLength(3);
    const ids = list.map((i) => i.id);
    expect(new Set(ids).size).toBe(3); // All unique
  });

  it('applies shared overrides to list', () => {
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const list = createInstitutionList(2, { tenantId });

    expect(list[0]!.tenantId).toBe(tenantId);
    expect(list[1]!.tenantId).toBe(tenantId);
  });
});

describe('Student Factory', () => {
  it('creates a valid student with all required fields', () => {
    const student = createStudent();

    expect(student.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(student.firstName).toBeTruthy();
    expect(student.lastName).toBeTruthy();
    expect(student.dateOfBirth).toBeInstanceOf(Date);
    expect(['MALE', 'FEMALE']).toContain(student.gender);
    expect(student.nationalId).toBeTruthy();
    expect(student.customData).toEqual({});
  });

  it('creates a list of students', () => {
    const list = createStudentList(5);

    expect(list).toHaveLength(5);
    const ids = list.map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('applies overrides', () => {
    const student = createStudent({ firstName: 'Alice', gender: 'FEMALE' });

    expect(student.firstName).toBe('Alice');
    expect(student.gender).toBe('FEMALE');
  });
});

describe('Staff Factory', () => {
  it('creates a valid staff with all required fields', () => {
    const staff = createStaff();

    expect(staff.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(staff.firstName).toBeTruthy();
    expect(staff.lastName).toBeTruthy();
    expect(staff.dateOfBirth).toBeInstanceOf(Date);
    expect(staff.identityNumber).toBeTruthy();
    expect(staff.email).toContain('@');
    expect(staff.phone).toBeTruthy();
    expect(staff.position).toBeTruthy();
    expect(staff.customData).toEqual({});
  });

  it('creates a list of staff', () => {
    const list = createStaffList(4);

    expect(list).toHaveLength(4);
    const ids = list.map((s) => s.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('position is from valid set', () => {
    const staff = createStaff();
    const validPositions = [
      'Teacher',
      'Principal',
      'Vice Principal',
      'Counselor',
      'Librarian',
      'Administrator',
    ];
    expect(validPositions).toContain(staff.position);
  });
});

describe('Enrollment Factory', () => {
  it('creates a valid enrollment', () => {
    const enrollment = createEnrollment();

    expect(enrollment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(enrollment.studentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(enrollment.institutionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(enrollment.academicPeriodId).toMatch(/^[0-9a-f-]{36}$/);
    expect(['ENROLLED', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED']).toContain(enrollment.status);
    expect(enrollment.startDate).toBeInstanceOf(Date);
  });

  it('applies overrides', () => {
    const enrollment = createEnrollment({ status: 'ENROLLED' });
    expect(enrollment.status).toBe('ENROLLED');
  });
});

describe('Area Factory', () => {
  it('creates a valid area', () => {
    const area = createArea();

    expect(area.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(area.name).toBeTruthy();
    expect(area.code).toBeTruthy();
    expect(area.level).toBeGreaterThanOrEqual(1);
    expect(area.deletedAt).toBeNull();
  });

  it('creates an area hierarchy with proper parent-child links', () => {
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const hierarchy = createAreaHierarchy(tenantId, 4);

    expect(hierarchy).toHaveLength(4);

    // First area has no parent
    expect(hierarchy[0]!.parentId).toBeNull();
    expect(hierarchy[0]!.level).toBe(1);
    expect(hierarchy[0]!.tenantId).toBe(tenantId);

    // Each subsequent area references the previous as parent
    for (let i = 1; i < hierarchy.length; i++) {
      expect(hierarchy[i]!.parentId).toBe(hierarchy[i - 1]!.id);
      expect(hierarchy[i]!.level).toBe(i + 1);
    }

    // Last area is a leaf
    expect(hierarchy[hierarchy.length - 1]!.isLeaf).toBe(true);
  });

  it('respects max depth of 10', () => {
    const hierarchy = createAreaHierarchy(undefined, 15);
    expect(hierarchy).toHaveLength(10);
  });
});

describe('AcademicPeriod Factory', () => {
  it('creates a valid academic period', () => {
    const period = createAcademicPeriod();

    expect(period.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(period.name).toContain('Academic Year');
    expect(period.code).toMatch(/^AY-\d{4}$/);
    expect(period.startDate).toBeInstanceOf(Date);
    expect(period.endDate).toBeInstanceOf(Date);
    expect(period.endDate.getTime()).toBeGreaterThan(period.startDate.getTime());
    expect(['ACTIVE', 'INACTIVE', 'ARCHIVED']).toContain(period.status);
  });

  it('applies overrides', () => {
    const period = createAcademicPeriod({ status: 'ACTIVE', name: 'Semester 1' });

    expect(period.status).toBe('ACTIVE');
    expect(period.name).toBe('Semester 1');
  });
});
