import { createLogger } from '@proctira/logging';

const logger = createLogger({ name: 'india-school' });

export const INDIA_DEMO_SCHOOL_CODE = 'KV-DEL-001';
export const INDIA_DEMO_SCHOOL_NAME = 'Kendriya Vidyalaya Proctira';

type Named = { id: string; code: string; name: string };

export type IndiaSchoolStore = {
  tenant: {
    findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
  };
  geographicArea: {
    findFirst: (args: {
      where: { tenantId: string; code: string };
    }) => Promise<{ id: string } | null>;
  };
  board: {
    findFirst: (args: {
      where: { tenantId: string; code: string; deletedAt: null };
    }) => Promise<{ id: string; code: string } | null>;
  };
  academicPeriod: {
    findFirst: (args: {
      where: { tenantId: string; code: string; deletedAt: null };
    }) => Promise<{ id: string; code: string } | null>;
  };
  grade: {
    findMany: (args: {
      where: { tenantId: string; deletedAt: null };
      orderBy: { order: 'asc' };
    }) => Promise<Array<{ id: string; code: string; name: string; order: number }>>;
  };
  institution: {
    findFirst: (args: {
      where: { tenantId: string; code: string; deletedAt: null };
    }) => Promise<{ id: string; name: string; code: string; boardId: string | null } | null>;
    create: (args: {
      data: {
        tenantId: string;
        name: string;
        code: string;
        areaId: string;
        boardId: string;
        type: string;
        sector: string;
        ownership: string;
        status: string;
        customData: Record<string, unknown>;
      };
    }) => Promise<{ id: string; name: string; code: string; boardId: string | null }>;
  };
  class: {
    findFirst: (args: {
      where: { tenantId: string; institutionId: string; gradeId: string; name: string; deletedAt: null };
    }) => Promise<{ id: string; name: string; gradeId: string } | null>;
    create: (args: {
      data: {
        tenantId: string;
        institutionId: string;
        gradeId: string;
        academicPeriodId: string;
        name: string;
        capacity: number;
      };
    }) => Promise<{ id: string; name: string; gradeId: string }>;
  };
};

export type SeedIndiaSchoolInput = {
  tenantSlug?: string;
  boardCode?: string;
  periodCode?: string;
};

export type SeedIndiaSchoolResult = {
  institution: { id: string; name: string; code: string; boardId: string | null };
  classes: Array<{ id: string; name: string; gradeId: string }>;
};

/**
 * Open the first India demo school and one section per grade for the
 * current academic year. Idempotent on school code + class name.
 */
export async function seedIndiaDemoSchool(
  db: IndiaSchoolStore,
  input: SeedIndiaSchoolInput = {},
): Promise<SeedIndiaSchoolResult> {
  const tenantSlug = input.tenantSlug ?? 'india';
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new Error(`Tenant '${tenantSlug}' is missing`);
  }

  const area = await db.geographicArea.findFirst({
    where: { tenantId: tenant.id, code: 'IN' },
  });
  if (!area) {
    throw new Error('India root area is missing');
  }

  const board = await db.board.findFirst({
    where: { tenantId: tenant.id, code: input.boardCode ?? 'CBSE', deletedAt: null },
  });
  if (!board) {
    throw new Error('CBSE board is missing — seed academic structure first');
  }

  const period = await db.academicPeriod.findFirst({
    where: { tenantId: tenant.id, code: input.periodCode ?? 'AY-2026-27', deletedAt: null },
  });
  if (!period) {
    throw new Error('Academic year AY-2026-27 is missing — seed academic structure first');
  }

  const grades = await db.grade.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: { order: 'asc' },
  });
  if (grades.length === 0) {
    throw new Error('Grades are missing — seed academic structure first');
  }

  let institution = await db.institution.findFirst({
    where: { tenantId: tenant.id, code: INDIA_DEMO_SCHOOL_CODE, deletedAt: null },
  });
  if (!institution) {
    institution = await db.institution.create({
      data: {
        tenantId: tenant.id,
        name: INDIA_DEMO_SCHOOL_NAME,
        code: INDIA_DEMO_SCHOOL_CODE,
        areaId: area.id,
        boardId: board.id,
        type: 'K12',
        sector: 'GOVERNMENT',
        ownership: 'CENTRAL',
        status: 'ACTIVE',
        customData: {
          __profile: {
            latitude: 28.6139,
            longitude: 77.209,
            address: 'New Delhi, India',
            contactPhone: '+911123456789',
            contactEmail: 'kv.delhi@proctira.in',
            deactivationReason: null,
          },
          udiseCode: '07010100101',
          affiliation: 'CBSE',
        },
      },
    });
    logger.info({ institutionId: institution.id, code: institution.code }, 'India demo school created');
  }

  const classes = [];
  for (const grade of grades) {
    const sectionName = `${grade.name} A`;
    const existing = await db.class.findFirst({
      where: {
        tenantId: tenant.id,
        institutionId: institution.id,
        gradeId: grade.id,
        name: sectionName,
        deletedAt: null,
      },
    });
    classes.push(
      existing ??
        (await db.class.create({
          data: {
            tenantId: tenant.id,
            institutionId: institution.id,
            gradeId: grade.id,
            academicPeriodId: period.id,
            name: sectionName,
            capacity: 40,
          },
        })),
    );
  }

  logger.info(
    { institutionId: institution.id, classes: classes.length },
    'India demo school classes ready',
  );

  return { institution, classes };
}

export type { Named };
