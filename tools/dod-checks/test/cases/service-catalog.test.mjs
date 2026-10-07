/**
 * PRC-M409: service scope is derived from packages/backend/* and pg `.query()`
 * SQL is scanned for cross-service JOINs.
 */
import { runApiSchemaCheck } from '../../src/checks/api-schema.mjs';
import { runCrossServiceJoinsCheck } from '../../src/checks/cross-service-joins.mjs';
import { listBackendServices } from '../../src/lib/paths.mjs';
import { withBackendFixture } from './fixture-utils.mjs';

export const title = 'service catalog: derived scope + pg query scanning (PRC-M409)';

const PLAIN_ROUTE = `export async function routes(app: any) {
  app.post('/x', async () => ({}));
}
`;

export async function run() {
  const results = [];

  const derived = await withBackendFixture(
    { 'brandnew/src/routes.ts': PLAIN_ROUTE, 'other/src/index.ts': 'export {};\n' },
    async (backendDir) => ({
      services: listBackendServices(backendDir),
      findings: (await runApiSchemaCheck({ backendDir })).findings,
    }),
  );
  results.push({
    name: 'service list is derived from packages/backend/* directories',
    ok: derived.services.join(',') === 'brandnew,other',
    message: JSON.stringify(derived.services),
  });
  results.push({
    name: 'a new backend package with routes and no schema fails api-schema',
    ok:
      derived.findings.length === 1 &&
      derived.findings[0].severity === 'error' &&
      /"brandnew"/.test(derived.findings[0].message),
    message: JSON.stringify(derived.findings),
  });

  const joins = await withBackendFixture(
    {
      'student/src/pg-repo.ts': `export class R {
  constructor(private pool: any) {}
  async list(tenantId: string) {
    return this.pool.query(
      \`SELECT s.* FROM student_students s JOIN staff_members m ON m.id = s.mentor_id WHERE s.tenant_id = \${'$'}1\`,
      [tenantId],
    );
  }
  async ok(tenantId: string) {
    return this.query(tenantId, 'SELECT * FROM student_students a JOIN student_guardians g ON g.id = a.g', []);
  }
  private query(_t: string, _s: string, _v: unknown[]) { return null; }
}
`,
      'staff/src/index.ts': 'export {};\n',
    },
    async (backendDir) => (await runCrossServiceJoinsCheck({ backendDir })).findings,
  );
  const errors = joins.filter((f) => f.severity === 'error');
  results.push({
    name: 'pg client.query JOIN across owned tables is flagged; same-service JOIN passes',
    ok: errors.length === 1 && /staff_members/.test(errors[0].message),
    message: JSON.stringify(joins),
  });

  return results;
}
