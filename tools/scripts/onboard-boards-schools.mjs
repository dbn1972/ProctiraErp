#!/usr/bin/env node
/**
 * Enterprise multi-board / multi-school onboarding CLI.
 *
 * Default: 3 boards × 2 schools × 500 students (in-memory certification graph).
 *
 * Usage:
 *   node tools/scripts/onboard-boards-schools.mjs
 *   STUDENTS_PER_SCHOOL=500 node tools/scripts/onboard-boards-schools.mjs
 *   OUT=/opt/cursor/artifacts/multi-board-onboard/summary.json node tools/scripts/onboard-boards-schools.mjs
 *
 * Persistence: when DATABASE_URL is set, prints a notice that Prisma persistence
 * must be run via packages/shared/database migrate+seed adapters (not invented here).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

async function loadSeedModule() {
  // Prefer workspace TypeScript source via tsx/vitest path; fall back to dynamic import of compiled-less TS via relative URL for node --import tsx.
  const candidates = [
    resolve(root, 'packages/shared/testing/src/database/multi-board-seed.ts'),
    resolve(root, 'packages/shared/testing/src/database/multi-board-seed.js'),
  ];
  for (const candidate of candidates) {
    try {
      return await import(pathToFileURL(candidate).href);
    } catch {
      // try next
    }
  }
  throw new Error('Unable to load multi-board-seed module');
}

async function main() {
  const studentsPerSchool = Number(process.env.STUDENTS_PER_SCHOOL ?? 500);
  const staffPerSchool = Number(process.env.STAFF_PER_SCHOOL ?? 25);
  const outPath =
    process.env.OUT ??
    resolve(root, '../../opt/cursor/artifacts/multi-board-onboard/summary.json');

  const mod = await loadSeedModule();
  const { seedMultiBoardSchools, assertMultiBoardSeedInvariants, DEFAULT_MULTI_BOARD_PROFILE } =
    mod;

  const started = Date.now();
  const result = seedMultiBoardSchools({ studentsPerSchool, staffPerSchool });
  assertMultiBoardSeedInvariants(result, {
    boards: DEFAULT_MULTI_BOARD_PROFILE.length,
    schools: DEFAULT_MULTI_BOARD_PROFILE.reduce((n, b) => n + b.schools.length, 0),
    studentsPerSchool,
  });
  const elapsedMs = Date.now() - started;

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: process.env.DATABASE_URL ? 'in-memory+db-url-present-not-persisted' : 'in-memory',
    databaseUrlPresent: Boolean(process.env.DATABASE_URL),
    elapsedMs,
    totals: result.totals,
    tenant: { id: result.tenant.id, slug: result.tenant.slug, name: result.tenant.name },
    boards: result.boards.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      type: b.type,
    })),
    schools: result.schools.map((s) => ({
      id: s.institution.id,
      code: s.institution.code,
      name: s.institution.name,
      boardCode: s.board.code,
      studentCount: s.students.length,
      staffCount: s.staff.length,
      enrollmentCount: s.enrollments.length,
      academicPeriodCode: s.academicPeriod.code,
    })),
    certificationChecks: {
      everySchoolHasBoard: result.schools.every((s) => s.institution.boardId === s.board.id),
      everyEnrollmentMatchesSchool: result.schools.every((s) =>
        s.enrollments.every((e) => e.institutionId === s.institution.id),
      ),
      uniqueBoardCodes: new Set(result.boards.map((b) => b.code)).size === result.boards.length,
      uniqueSchoolCodes:
        new Set(result.schools.map((s) => s.institution.code)).size === result.schools.length,
    },
  };

  const absOut = resolve(outPath);
  mkdirSync(dirname(absOut), { recursive: true });
  writeFileSync(absOut, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({ ok: true, out: absOut, totals: summary.totals, elapsedMs }, null, 2));
  if (process.env.DATABASE_URL) {
    console.error(
      '[onboard-boards-schools] DATABASE_URL is set but this CLI persists in-memory only; wire Prisma adapter before claiming DB-backed onboarding.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
