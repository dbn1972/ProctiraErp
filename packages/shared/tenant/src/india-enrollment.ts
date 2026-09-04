import { createLogger } from '@proctira/logging';

import { INDIA_DEMO_SCHOOL_CODE } from './india-school.js';

const logger = createLogger({ name: 'india-enrollment' });

export const INDIA_DEMO_STUDENT_NATIONAL_ID = 'INDIA-DEMO-0001';
export const INDIA_DEMO_STUDENT_FIRST_NAME = 'Aarav';
export const INDIA_DEMO_STUDENT_LAST_NAME = 'Sharma';
export const INDIA_DEMO_STUDENT_DOB = '2019-08-12';
export const INDIA_DEMO_CLASS_NAME = 'Class 1 A';
export const INDIA_DEMO_ENROLLED_AT = '2026-04-01';

export type IndiaEnrollmentStore = {
  tenant: {
    findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
  };
  institution: {
    findFirst: (args: {
      where: { tenantId: string; code: string; deletedAt: null };
    }) => Promise<{ id: string; name: string; code: string } | null>;
  };
  academicPeriod: {
    findFirst: (args: {
      where: { tenantId: string; code: string; deletedAt: null };
    }) => Promise<{ id: string; code: string } | null>;
  };
  class: {
    findFirst: (args: {
      where: { tenantId: string; institutionId: string; name: string; deletedAt: null };
    }) => Promise<{ id: string; name: string; gradeId: string } | null>;
  };
  student: {
    findFirst: (args: {
      where: { tenantId: string; nationalId: string; deletedAt: null };
    }) => Promise<{
      id: string;
      firstName: string;
      lastName: string;
      nationalId: string | null;
    } | null>;
    create: (args: {
      data: {
        tenantId: string;
        firstName: string;
        lastName: string;
        dateOfBirth: Date;
        gender: string;
        nationalId: string;
        customData: Record<string, unknown>;
      };
    }) => Promise<{
      id: string;
      firstName: string;
      lastName: string;
      nationalId: string | null;
    }>;
  };
  enrollment: {
    findFirst: (args: {
      where: {
        tenantId: string;
        studentId: string;
        institutionId: string;
        academicPeriodId: string;
      };
    }) => Promise<{
      id: string;
      studentId: string;
      institutionId: string;
      classId: string | null;
      status: string;
    } | null>;
    create: (args: {
      data: {
        tenantId: string;
        studentId: string;
        institutionId: string;
        gradeId: string;
        classId: string;
        academicPeriodId: string;
        status: 'ENROLLED';
        enrolledAt: Date;
      };
    }) => Promise<{
      id: string;
      studentId: string;
      institutionId: string;
      classId: string | null;
      status: string;
    }>;
  };
  enrollmentHistory: {
    findFirst: (args: {
      where: { tenantId: string; enrollmentId: string };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        tenantId: string;
        enrollmentId: string;
        previousStatus: null;
        newStatus: string;
        effectiveDate: Date;
        institutionId: string;
        academicPeriodId: string;
        reason: string;
      };
    }) => Promise<{ id: string }>;
  };
};

export type SeedIndiaEnrollmentInput = {
  tenantSlug?: string;
  periodCode?: string;
};

export type SeedIndiaEnrollmentResult = {
  student: { id: string; firstName: string; lastName: string; nationalId: string | null };
  enrollment: {
    id: string;
    studentId: string;
    institutionId: string;
    classId: string | null;
    status: string;
  };
};

/**
 * Admit the first India demo student into KV Proctira Class 1 A.
 * Idempotent on national id + school + academic year.
 */
export async function seedIndiaDemoEnrollment(
  db: IndiaEnrollmentStore,
  input: SeedIndiaEnrollmentInput = {},
): Promise<SeedIndiaEnrollmentResult> {
  const tenantSlug = input.tenantSlug ?? 'india';
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new Error(`Tenant '${tenantSlug}' is missing`);
  }

  const institution = await db.institution.findFirst({
    where: { tenantId: tenant.id, code: INDIA_DEMO_SCHOOL_CODE, deletedAt: null },
  });
  if (!institution) {
    throw new Error('India demo school is missing — seed the school first');
  }

  const period = await db.academicPeriod.findFirst({
    where: { tenantId: tenant.id, code: input.periodCode ?? 'AY-2026-27', deletedAt: null },
  });
  if (!period) {
    throw new Error('Academic year AY-2026-27 is missing — seed academic structure first');
  }

  const klass = await db.class.findFirst({
    where: {
      tenantId: tenant.id,
      institutionId: institution.id,
      name: INDIA_DEMO_CLASS_NAME,
      deletedAt: null,
    },
  });
  if (!klass) {
    throw new Error('Class 1 A is missing — seed the India demo school first');
  }

  let student = await db.student.findFirst({
    where: { tenantId: tenant.id, nationalId: INDIA_DEMO_STUDENT_NATIONAL_ID, deletedAt: null },
  });
  if (!student) {
    student = await db.student.create({
      data: {
        tenantId: tenant.id,
        firstName: INDIA_DEMO_STUDENT_FIRST_NAME,
        lastName: INDIA_DEMO_STUDENT_LAST_NAME,
        dateOfBirth: new Date(`${INDIA_DEMO_STUDENT_DOB}T00:00:00.000Z`),
        gender: 'male',
        nationalId: INDIA_DEMO_STUDENT_NATIONAL_ID,
        customData: {
          __profile: {
            nationality: 'Indian',
            contacts: [],
            guardians: [
              {
                id: 'india-demo-guardian-1',
                firstName: 'Rajesh',
                lastName: 'Sharma',
                relationship: 'father',
                contactPhone: '+911198765432',
                contactEmail: 'rajesh.sharma@example.in',
              },
            ],
            identityDocuments: [],
          },
          admissionNumber: 'KV-DEL-001-0001',
        },
      },
    });
    logger.info({ studentId: student.id }, 'India demo student created');
  }

  let enrollment = await db.enrollment.findFirst({
    where: {
      tenantId: tenant.id,
      studentId: student.id,
      institutionId: institution.id,
      academicPeriodId: period.id,
    },
  });
  if (!enrollment) {
    enrollment = await db.enrollment.create({
      data: {
        tenantId: tenant.id,
        studentId: student.id,
        institutionId: institution.id,
        gradeId: klass.gradeId,
        classId: klass.id,
        academicPeriodId: period.id,
        status: 'ENROLLED',
        enrolledAt: new Date(`${INDIA_DEMO_ENROLLED_AT}T00:00:00.000Z`),
      },
    });
    logger.info({ enrollmentId: enrollment.id, studentId: student.id }, 'India demo enrollment created');
  }

  const history = await db.enrollmentHistory.findFirst({
    where: { tenantId: tenant.id, enrollmentId: enrollment.id },
  });
  if (!history) {
    await db.enrollmentHistory.create({
      data: {
        tenantId: tenant.id,
        enrollmentId: enrollment.id,
        previousStatus: null,
        newStatus: 'ENROLLED',
        effectiveDate: new Date(`${INDIA_DEMO_ENROLLED_AT}T00:00:00.000Z`),
        institutionId: institution.id,
        academicPeriodId: period.id,
        reason: 'Initial enrollment',
      },
    });
  }

  return { student, enrollment };
}
