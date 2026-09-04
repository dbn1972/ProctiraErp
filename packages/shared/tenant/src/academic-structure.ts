import {
  academicYearWindow,
  countryBoardDefinitions,
  countryDefaultGrades,
  requireCountry,
} from '@proctira/common';
import { createLogger } from '@proctira/logging';

const logger = createLogger({ name: 'academic-structure' });

export type AcademicStructureStore = {
  board: {
    upsert: (args: {
      where: { tenantId_code: { tenantId: string; code: string } };
      create: {
        tenantId: string;
        name: string;
        code: string;
        type: 'NATIONAL' | 'STATE' | 'PRIVATE';
        status: string;
      };
      update: { name: string; type: 'NATIONAL' | 'STATE' | 'PRIVATE'; status: string; deletedAt: null };
    }) => Promise<{ id: string; code: string; name: string; type: string }>;
  };
  academicPeriod: {
    upsert: (args: {
      where: { tenantId_code: { tenantId: string; code: string } };
      create: {
        tenantId: string;
        name: string;
        code: string;
        startDate: Date;
        endDate: Date;
        status: string;
      };
      update: { name: string; startDate: Date; endDate: Date; status: string; deletedAt: null };
    }) => Promise<{ id: string; code: string; name: string }>;
  };
  grade: {
    upsert: (args: {
      where: { tenantId_code: { tenantId: string; code: string } };
      create: { tenantId: string; name: string; code: string; order: number };
      update: { name: string; order: number; deletedAt: null };
    }) => Promise<{ id: string; code: string; name: string; order: number }>;
  };
};

export type SeedAcademicStructureInput = {
  tenantId: string;
  countryCode?: string;
  now?: Date;
};

export type SeedAcademicStructureResult = {
  boards: Array<{ id: string; code: string; name: string; type: string }>;
  academicPeriod: { id: string; code: string; name: string };
  grades: Array<{ id: string; code: string; name: string; order: number }>;
};

/**
 * Idempotently seed boards, the current academic year, and default grades
 * for a tenant from the country catalog. India is Class 1–12 + CBSE/ICSE/State.
 */
export async function seedAcademicStructure(
  db: AcademicStructureStore,
  input: SeedAcademicStructureInput,
): Promise<SeedAcademicStructureResult> {
  const country = requireCountry(input.countryCode ?? 'IN');
  const year = academicYearWindow(country.academicYearStartMonth, input.now);

  logger.info(
    { tenantId: input.tenantId, country: country.code, period: year.code },
    'Seeding academic structure',
  );

  const boards = [];
  for (const board of countryBoardDefinitions(country)) {
    boards.push(
      await db.board.upsert({
        where: { tenantId_code: { tenantId: input.tenantId, code: board.code } },
        create: {
          tenantId: input.tenantId,
          name: board.name,
          code: board.code,
          type: board.type,
          status: 'active',
        },
        update: {
          name: board.name,
          type: board.type,
          status: 'active',
          deletedAt: null,
        },
      }),
    );
  }

  const academicPeriod = await db.academicPeriod.upsert({
    where: { tenantId_code: { tenantId: input.tenantId, code: year.code } },
    create: {
      tenantId: input.tenantId,
      name: year.name,
      code: year.code,
      startDate: new Date(`${year.startDate}T00:00:00.000Z`),
      endDate: new Date(`${year.endDate}T00:00:00.000Z`),
      status: 'active',
    },
    update: {
      name: year.name,
      startDate: new Date(`${year.startDate}T00:00:00.000Z`),
      endDate: new Date(`${year.endDate}T00:00:00.000Z`),
      status: 'active',
      deletedAt: null,
    },
  });

  const grades = [];
  for (const grade of countryDefaultGrades(country)) {
    grades.push(
      await db.grade.upsert({
        where: { tenantId_code: { tenantId: input.tenantId, code: grade.code } },
        create: {
          tenantId: input.tenantId,
          name: grade.name,
          code: grade.code,
          order: grade.order,
        },
        update: {
          name: grade.name,
          order: grade.order,
          deletedAt: null,
        },
      }),
    );
  }

  logger.info(
    {
      tenantId: input.tenantId,
      boards: boards.length,
      grades: grades.length,
      period: academicPeriod.code,
    },
    'Academic structure seeded',
  );

  return { boards, academicPeriod, grades };
}
