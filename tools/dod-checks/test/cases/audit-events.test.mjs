/**
 * Fixture tests for the audit-event emission check (PRC-L504). Runs the real
 * `runAuditEventsCheck` against a synthetic backend tree.
 */
import { runAuditEventsCheck } from '../../src/checks/audit-events.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toRepoRelative } from '../../src/lib/paths.mjs';
import { withBackendFixture } from './fixture-utils.mjs';

export const title = 'audit-events: write routes must emit audit events';

const WRITE_ROUTE = `export async function feeRoutes(app: any) {
  app.post('/fees', async (req: any) => app.feeService.create(req.body));
}
`;

const SILENT_SERVICE = `export class FeeService {
  async create(input: any) { return input; }
}
`;

async function warningsFor(files, allowlistPath = null) {
  return withBackendFixture(files, async (backendDir) => {
    const report = await runAuditEventsCheck({ backendDir, allowlistPath });
    return report.findings.filter((f) => f.severity === 'error');
  });
}

export async function run() {
  const results = [];

  const flagged = await warningsFor({
    'fees/src/fee-routes.ts': WRITE_ROUTE,
    'fees/src/fee-service.ts': SILENT_SERVICE,
  });
  results.push({
    name: 'write route with no audit emission in routes or services is flagged',
    ok:
      flagged.length === 1 &&
      /"fees"/.test(flagged[0].message) &&
      /POST \/fees/.test(flagged[0].message) &&
      flagged[0].line === 2,
    message: JSON.stringify(flagged),
  });

  const viaService = await warningsFor({
    'fees/src/fee-routes.ts': WRITE_ROUTE,
    'fees/src/fee-service.ts': `export class FeeService {
  constructor(private readonly auditService: any) {}
  async create(input: any) {
    await this.auditService.record({ action: 'fee.create' });
    return input;
  }
}
`,
  });
  // PRC-M410: importing/injecting the audit service is not enough; the
  // handler (or the method it calls) must actually call it.
  const importOnly = await warningsFor({
    'fees/src/fee-routes.ts': `import { AuditService } from '@proctira/audit';
export async function feeRoutes(app: any, auditService: AuditService) {
  app.post('/fees', async (req: any) => app.feeService.create(req.body));
  app.delete('/fees/:id', async (req: any) => {
    await auditService.record({ action: 'fee.delete' });
    return app.feeService.remove(req.params.id);
  });
}
`,
    'fees/src/fee-service.ts': `import { auditService } from './audit';
export class FeeService {
  // audit me later
  async create(input: any) { return input; }
  async remove(id: string) { return id; }
}
`,
  });
  results.push({
    name: 'audit import without a call in the POST handler path is flagged (per handler)',
    ok: importOnly.length === 1 && /POST \/fees/.test(importOnly[0].message),
    message: JSON.stringify(importOnly),
  });
  const otherReceiver = await warningsFor({
    'fees/src/fee-routes.ts': `export async function feeRoutes(scoped: any) {
  scoped.patch('/fees/:id', async (req: any) => scoped.feeService.update(req.body));
  const cache = new Map(); cache.delete('k');
}
`,
    'fees/src/fee-service.ts': SILENT_SERVICE,
  });
  results.push({
    name: 'any receiver (not only fastify/app) is matched; Map.delete(key) is not a route',
    ok: otherReceiver.length === 1 && /PATCH/.test(otherReceiver[0].message),
    message: JSON.stringify(otherReceiver),
  });
  const allowDir = await mkdtemp(join(tmpdir(), 'audit-allow-'));
  const allowPath = join(allowDir, 'allow.json');
  await writeFile(
    allowPath,
    JSON.stringify({
      entries: [{ file: 'fees/src/fee-routes.ts', route: 'POST /fees', reason: 'fixture' }],
    }),
  );
  const allowed = await withBackendFixture(
    { 'fees/src/fee-routes.ts': WRITE_ROUTE, 'fees/src/fee-service.ts': SILENT_SERVICE },
    async (backendDir) => {
      const raw = JSON.parse(await readFile(allowPath, 'utf8'));
      raw.entries[0].file = toRepoRelative(join(backendDir, 'fees/src/fee-routes.ts'));
      await writeFile(allowPath, JSON.stringify(raw));
      const report = await runAuditEventsCheck({ backendDir, allowlistPath: allowPath });
      return report.findings;
    },
  );
  await rm(allowDir, { recursive: true, force: true });
  results.push({
    name: 'explicitly allowlisted un-audited route is not an error',
    ok: allowed.filter((f) => f.severity === 'error').length === 0,
    message: JSON.stringify(allowed),
  });
  results.push({
    name: 'audit integration in the service file satisfies the check',
    ok: viaService.length === 0,
    message: JSON.stringify(viaService),
  });

  const exempt = await warningsFor({
    'fees/src/fee-routes.ts': `export async function feeRoutes(app: any) {
  app.get('/fees', async () => []);
}
`,
    'audit/src/audit-routes.ts': WRITE_ROUTE,
  });
  results.push({
    name: 'read-only routes and the audit service itself are exempt',
    ok: exempt.length === 0,
    message: JSON.stringify(exempt),
  });

  return results;
}
