/**
 * Live WS4 board export smoke against proctira-multiboard-cert.
 * Writes evidence under /opt/cursor/artifacts/sis-board-exports/.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BusinessRuleError } from '@proctira/common';

import { createGradebookRepository } from '../src/repository-factory.js';
import { GradebookService } from '../src/gradebook-service.js';

const TENANT = 'f342575b-5360-4937-9a2a-275c8543f1c6';

const BOARDS = [
  {
    code: 'CBSE',
    id: '5834f5d7-a3fd-4c97-8d56-8fcd97ade2f9',
    institutionId: '2e0126f1-752b-4d63-ba57-633a83cc6508',
  },
  {
    code: 'ICSE',
    id: 'ea32355d-a670-431b-a914-37860eaa3542',
    institutionId: '30a9ae8b-761f-4dff-a221-c477beaa8580',
  },
  {
    code: 'MH-STATE',
    id: '4a8808bf-3d2c-4800-b853-a2ddb0372a64',
    institutionId: 'fbb89cbd-f78b-4659-9ed5-94961455b94d',
  },
];

async function main() {
  process.env.SIS_BOARD_EXPORT_DIR =
    process.env.SIS_BOARD_EXPORT_DIR || '/opt/cursor/artifacts/sis-board-exports';
  mkdirSync(process.env.SIS_BOARD_EXPORT_DIR, { recursive: true });

  const service = new GradebookService(createGradebookRepository());
  const results = [];

  for (const board of BOARDS) {
    const job = await service.createBoardExportJob(TENANT, {
      boardId: board.id,
      institutionId: board.institutionId,
      limit: 50,
    });
    const csv = await service.downloadBoardExport(TENANT, job.id, 'csv');
    const packExists = job.artifactUri ? existsSync(job.artifactUri) : false;
    results.push({
      board: board.code,
      jobId: job.id,
      status: job.status,
      artifactUri: job.artifactUri,
      checksum: job.metadata.checksumSha256,
      candidateCount: job.metadata.candidateCount,
      packExists,
      csvBytes: csv.body.length,
      csvHead: csv.body.toString('utf8').split('\n').slice(0, 2),
    });
  }

  // Negative: incomplete grades → 422 BusinessRuleError
  let incompleteBlocked = false;
  let incompleteMessage = '';
  try {
    // Second CBSE student typically has only MATH from seed 005
    const incompleteStudent = 'bd44930a-a9bf-4cf8-9e21-ee85d1a69660';
    await service.createBoardExportJob(TENANT, {
      boardCode: 'CBSE',
      institutionId: BOARDS[0].institutionId,
      studentIds: [incompleteStudent],
    });
  } catch (error) {
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(/** @type {{ statusCode?: number }} */ (error).statusCode)
        : NaN;
    incompleteBlocked = error instanceof BusinessRuleError || statusCode === 422;
    incompleteMessage = error instanceof Error ? error.message : String(error);
  }

  const evidenceDir = '/opt/cursor/artifacts/sis-board-exports';
  mkdirSync(evidenceDir, { recursive: true });
  const summary = {
    tenant: TENANT,
    generatedAt: new Date().toISOString(),
    packs: results,
    incompleteBlocked,
    incompleteMessage: incompleteMessage.slice(0, 240),
    allSucceeded: results.every((r) => r.status === 'SUCCEEDED' && r.packExists),
  };
  const summaryPath = join(evidenceDir, 'live-smoke-summary.json');
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.allSucceeded || !incompleteBlocked) {
    process.exitCode = 1;
  }

  // Prove artifact readable
  for (const r of results) {
    if (r.artifactUri) {
      const body = readFileSync(r.artifactUri, 'utf8');
      if (!body.includes(r.board)) {
        console.error(`Pack missing board code ${r.board}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
