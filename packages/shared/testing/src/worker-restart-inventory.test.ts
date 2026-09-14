/**
 * W3-C3 — worker / consumer restart-safe evidence inventory.
 *
 * Fails CI when a queue-backed worker domain loses its restart proof test file.
 * Domains marked NON-GOAL are documented in docs/audits/DEV_W3_C3_WORKER_RESTART_PROOF.md.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Repo root when tests run via pnpm --filter from monorepo root. */
function repoRoot(): string {
  const candidates = [
    process.cwd(),
    join(process.cwd(), '../..'),
    join(process.cwd(), '../../..'),
  ];
  for (const root of candidates) {
    if (existsSync(join(root, 'pnpm-workspace.yaml'))) return root;
  }
  return process.cwd();
}

const ROOT = repoRoot();

type WorkerProofKind = 'queue-restart' | 'lease-reclaim' | 'hydrate-restart';

interface WorkerProofEntry {
  domain: string;
  worker: string;
  evidencePath: string;
  kind: WorkerProofKind;
}

/** Queue consumers that must carry a crash → redeliver integration proof. */
const QUEUE_RESTART_PROOFS: WorkerProofEntry[] = [
  {
    domain: 'exam-document',
    worker: 'workers/exam-document',
    evidencePath: 'workers/exam-document/src/__tests__/restart-safe.test.ts',
    kind: 'queue-restart',
  },
  {
    domain: 'notification-delivery',
    worker: 'packages/backend/notification',
    evidencePath: 'packages/backend/notification/src/delivery-restart-safe.test.ts',
    kind: 'queue-restart',
  },
  {
    domain: 'workflow-escalation',
    worker: 'packages/backend/workflow',
    evidencePath: 'packages/backend/workflow/src/escalation-restart-safe.test.ts',
    kind: 'queue-restart',
  },
  {
    domain: 'student-import',
    worker: 'packages/backend/student',
    evidencePath: 'packages/backend/student/src/import/import-queue.durability.test.ts',
    kind: 'queue-restart',
  },
  {
    domain: 'webhook-delivery',
    worker: 'packages/backend/developer-portal',
    evidencePath: 'packages/backend/developer-portal/src/webhook-dispatch.durability.test.ts',
    kind: 'queue-restart',
  },
  {
    domain: 'report-card',
    worker: 'packages/backend/assessment',
    evidencePath: 'packages/backend/assessment/src/report-card-queue.durability.test.ts',
    kind: 'queue-restart',
  },
  {
    domain: 'queue-abstraction',
    worker: 'packages/shared/queue-abstraction',
    evidencePath: 'packages/shared/queue-abstraction/src/__tests__/in-memory-durable.test.ts',
    kind: 'queue-restart',
  },
];

/** In-process schedulers / job runners with durable lease or hydrate proofs. */
const LEASE_OR_HYDRATE_PROOFS: WorkerProofEntry[] = [
  {
    domain: 'report-jobs',
    worker: 'packages/backend/report',
    evidencePath: 'packages/backend/report/src/job-leasing-cancellation.test.ts',
    kind: 'lease-reclaim',
  },
  {
    domain: 'report-schedules',
    worker: 'packages/backend/report',
    evidencePath: 'packages/backend/report/src/catalogue-service.test.ts',
    kind: 'lease-reclaim',
  },
  {
    domain: 'etl-scheduler',
    worker: 'packages/backend/etl',
    evidencePath: 'packages/backend/etl/src/pipeline-scheduler.durability.test.ts',
    kind: 'hydrate-restart',
  },
];

describe('W3-C3 worker restart-safe evidence inventory', () => {
  it.each(QUEUE_RESTART_PROOFS)(
    '$domain has queue restart proof at $evidencePath',
    ({ evidencePath }) => {
      expect(existsSync(join(ROOT, evidencePath))).toBe(true);
    },
  );

  it.each(LEASE_OR_HYDRATE_PROOFS)(
    '$domain has lease/hydrate restart proof at $evidencePath',
    ({ evidencePath }) => {
      expect(existsSync(join(ROOT, evidencePath))).toBe(true);
    },
  );

  it('documents dated NON-GOAL workers in the W3-C3 DEV audit', () => {
    const auditPath = join(ROOT, 'docs/audits/DEV_W3_C3_WORKER_RESTART_PROOF.md');
    expect(existsSync(auditPath)).toBe(true);
    // Attendance bulk consumer remains explicitly out of scope until a worker ships.
  });
});
