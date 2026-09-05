import { getPrismaClient } from '@proctira/database';

import {
  seedIndiaDemoEnrollment,
  type IndiaEnrollmentStore,
} from './india-enrollment.js';

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  try {
    // PrismaClient is structurally compatible at runtime; the store type is a
    // narrow test/seed seam and is not identical to generated Prisma types
    // (e.g. Json value variance on customData).
    const result = await seedIndiaDemoEnrollment(
      prisma as unknown as IndiaEnrollmentStore,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
