import { getPrismaClient } from '@proctira/database';

import { seedIndiaDemoEnrollment } from './india-enrollment.js';

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const result = await seedIndiaDemoEnrollment(prisma);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
