import { createGradebookRepository } from '../src/repository-factory.js';
import { GradebookService } from '../src/gradebook-service.js';

async function main() {
  const TENANT = 'f342575b-5360-4937-9a2a-275c8543f1c6';
  const SECTION = '17b2fca3-0af2-429d-a8a4-f27115f762d0';
  const STUDENT = '47aa5dfc-169a-4664-a7a4-951364b0680c';
  const BOARD = '5834f5d7-a3fd-4c97-8d56-8fcd97ade2f9';

  const service = new GradebookService(createGradebookRepository());
  const e1 = await service.upsertGradeEntry(TENANT, {
    sectionId: SECTION,
    studentId: STUDENT,
    assessmentCode: 'MATH',
    numericScore: 95,
    creditRuleCode: 'CBSE-CORE',
  });
  const e2 = await service.upsertGradeEntry(TENANT, {
    sectionId: SECTION,
    studentId: STUDENT,
    assessmentCode: 'SCI',
    numericScore: 84,
    creditRuleCode: 'CBSE-CORE',
  });
  const { snapshot } = await service.computeGpa(TENANT, {
    studentId: STUDENT,
    boardId: BOARD,
  });

  const listedBefore = await service.listTranscripts(TENANT, { studentId: STUDENT });
  const priorMaxVersion = listedBefore.reduce((m, t) => Math.max(m, t.version), 0);

  const t1 = await service.issueTranscript(TENANT, {
    studentId: STUDENT,
    gpaSnapshotId: snapshot.id,
  });
  const t2 = await service.issueTranscript(TENANT, { studentId: STUDENT });
  const job = await service.createReportCardJob(TENANT, {
    studentId: STUDENT,
    boardId: BOARD,
    institutionId: '2e0126f1-752b-4d63-ba57-633a83cc6508',
  });
  const listed = await service.listTranscripts(TENANT, { studentId: STUDENT });
  const out = {
    entries: [e1.id, e2.id],
    gpa: {
      id: snapshot.id,
      weighted: snapshot.weightedGpa,
      unweighted: snapshot.unweightedGpa,
      credits: snapshot.creditsEarned,
    },
    transcripts: listed.map((t) => ({
      version: t.version,
      checksum: t.checksumSha256?.slice(0, 12),
      status: t.status,
    })),
    reportCard: { id: job.id, status: job.status, artifact: job.artifactUri },
    immutabilityOk:
      t1.checksumSha256 !== t2.checksumSha256 &&
      t1.version === priorMaxVersion + 1 &&
      t2.version === priorMaxVersion + 2,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.immutabilityOk) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
