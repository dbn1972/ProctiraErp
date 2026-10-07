/**
 * Fixture tests for the tenant-id threading check (PRC-L504). Runs the real
 * `runTenantIdCheck` against a synthetic backend tree.
 */
import { runTenantIdCheck } from '../../src/checks/tenant-id.mjs';
import { resolve } from 'node:path';
import { withBackendFixture } from './fixture-utils.mjs';

export const title = 'tenant-id: persistence methods must carry tenantId';

const VIOLATION = `export class StudentService {
  constructor(private readonly repository: any) {}
  async listStudents(filter: string) {
    return this.repository.findMany({ where: { name: filter } });
  }
}
`;

async function errorsFor(files) {
  return withBackendFixture(files, async (backendDir) => {
    const report = await runTenantIdCheck({ backendDir });
    return report.findings.filter((f) => f.severity === 'error');
  });
}

export async function run() {
  const results = [];

  const flagged = await errorsFor({ 'student/src/student-service.ts': VIOLATION });
  results.push({
    name: 'public persistence method without tenantId is flagged',
    ok: flagged.length === 1 && /StudentService\.listStudents/.test(flagged[0].message),
    message: `expected 1 error for listStudents, got ${JSON.stringify(flagged.map((f) => f.message))}`,
  });

  const compliant = await errorsFor({
    'student/src/student-service.ts': `export class StudentService {
  constructor(private readonly repository: any) {}
  async listStudents(tenantId: string, filter: string) {
    return this.repository.findMany({ where: { tenantId, name: filter } });
  }
  async createStudent(input: { tenantId: string; name: string }) {
    return this.repository.create({ data: { tenantId: input.tenantId, name: input.name } });
  }
}
`,
  });
  results.push({
    name: 'tenantId argument and input-object tenantId are accepted',
    ok: compliant.length === 0,
    message: JSON.stringify(compliant.map((f) => f.message)),
  });

  const exempt = await errorsFor({
    'student/src/student-service.ts': `export class StudentService {
  constructor(private readonly repository: any) {}
  /** @tenantExempt pure formatter over a global lookup table */
  formatName(value: string) {
    return this.repository.find(value);
  }
  private async loadRaw(filter: string) {
    return this.repository.findMany(filter);
  }
}
`,
    'tenant/src/tenant-service.ts': VIOLATION.replace('StudentService', 'TenantService'),
  });
  results.push({
    name: 'explicit @tenantExempt, private methods and tenant bootstrap service are exempt',
    ok: exempt.length === 0,
    message: JSON.stringify(exempt.map((f) => f.message)),
  });

  // PRC-M408: name-based exemptions are gone.
  const byName = await errorsFor({
    'fees/src/fee-service.ts': `export class FeeService {
  constructor(private readonly prisma: any) {}
  async updateFeeStatus(id: string, status: string) {
    return this.prisma.fee.update({ where: { id }, data: { status } });
  }
  async findFeeById(id: string) {
    return this.prisma.fee.findUnique({ where: { id } });
  }
  async listAll() {
    return this.prisma.fee.findMany();
  }
}
`,
  });
  results.push({
    name: 'PRC-M408: updateXStatus(id) / findXById / zero-arg persistence methods are flagged',
    ok:
      byName.length === 3 &&
      byName.some((f) => /updateFeeStatus/.test(f.message)) &&
      byName.some((f) => /findFeeById/.test(f.message)) &&
      byName.some((f) => /listAll/.test(f.message)),
    message: JSON.stringify(byName.map((f) => f.message)),
  });

  const unused = await errorsFor({
    'fees/src/fee-service.ts': `export class FeeService {
  constructor(private readonly repository: any) {}
  async getFee(tenantIdArg_unused: string, id: string) {
    return this.repository.findUnique({ where: { id } });
  }
}
`.replace('tenantIdArg_unused', 'tenantId'),
  });
  results.push({
    name: 'PRC-M408: declared-but-unused tenantId is flagged',
    ok:
      unused.length === 1 &&
      /declares a tenant parameter but never uses it/.test(unused[0].message),
    message: JSON.stringify(unused.map((f) => f.message)),
  });

  // PRC-M408: repository SQL on tenant tables needs a tenant predicate or tenant-bound helper.
  const sqlFindings = await withBackendFixture(
    {
      '../../db/sql/001_fees.sql':
        'CREATE TABLE IF NOT EXISTS fee_invoices (\n  id uuid PRIMARY KEY,\n  tenant_id uuid NOT NULL\n);\nCREATE TABLE fee_catalog (\n  id uuid PRIMARY KEY\n);\n',
      'fees/src/pg-fee-repository.ts': `export class PgFeeRepository {
  constructor(private readonly pool: any) {}
  async byId(id: string) {
    return this.pool.query('SELECT * FROM fee_invoices WHERE id = $1', [id]);
  }
  async scoped(tenantId: string, id: string) {
    return this.pool.query('SELECT * FROM fee_invoices WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  }
  async bound(tenantId: string) {
    return withPgTenant(this.pool, tenantId, (c: any) => c.query('SELECT * FROM fee_invoices'));
  }
  async catalog() {
    return this.pool.query('SELECT * FROM fee_catalog');
  }
}
declare function withPgTenant(p: any, t: string, f: (c: any) => unknown): unknown;
`,
    },
    async (backendDir) => {
      const report = await runTenantIdCheck({
        backendDir,
        sqlDir: resolve(backendDir, '../../db/sql'),
      });
      return report.findings.filter(
        (f) => f.severity === 'error' && /SQL on tenant/.test(f.message),
      );
    },
  );
  results.push({
    name: 'PRC-M408: unscoped SQL on a tenant table is flagged; predicate/helper/non-tenant tables pass',
    ok: sqlFindings.length === 1 && sqlFindings[0].line === 4,
    message: JSON.stringify(sqlFindings.map((f) => `${f.line}: ${f.message}`)),
  });
  // PR #579 precision rules — signature lint.
  const precision = await errorsFor({
    'staff/src/staff-service.ts': `export class StaffService {
  constructor(private readonly repository: any) {}
  supportsTransactions(): boolean {
    return typeof this.repository.withTransaction === 'function';
  }
  async processTask(payload: { tenantId: string; id: string }) {
    const { tenantId, id } = payload;
    return this.repository.findById(id, tenantId);
  }
  async review(id: string, reviewer: { tenantId?: string } = {}) {
    const row = await this.repository.findById(id);
    await this.assertNotSelf(row, reviewer);
    return row;
  }
  private async assertNotSelf(row: any, reviewer: { tenantId?: string }) {
    return this.repository.list({ tenantId: reviewer.tenantId, owner: row.owner });
  }
}
`,
  });
  results.push({
    name: 'PR #579: typeof capability probe, destructured tenantId and forwarded tenant param pass',
    ok: precision.length === 0,
    message: JSON.stringify(precision.map((f) => f.message)),
  });

  const stillFlagged = await errorsFor({
    'staff/src/staff-service.ts': `export class StaffService {
  constructor(private readonly repository: any) {}
  async probeThenRead(id: string) {
    if (typeof this.repository.findById !== 'function') return null;
    return this.repository.findById(id);
  }
  async processTask(payload: { id: string }) {
    const { tenantId } = this.defaults;
    return this.repository.findById(payload.id);
  }
}
`,
  });
  results.push({
    name: 'PR #579: a probe followed by real repository use, and non-param destructuring, still flag',
    ok:
      stillFlagged.length === 2 &&
      stillFlagged.some((f) => /probeThenRead/.test(f.message)) &&
      stillFlagged.some((f) => /processTask/.test(f.message)),
    message: JSON.stringify(stillFlagged.map((f) => f.message)),
  });

  // PR #579: platform-scoped operations registry (per class + operation).
  const platformScopes = [
    {
      file: 'billing/src/billing-service.ts',
      className: 'BillingService',
      receiver: 'repository',
      operations: ['findPlanById', 'listTenants'],
      reason: 'fixture: plan catalogue is platform-scoped',
    },
  ];
  const platformFindings = await withBackendFixture(
    {
      'billing/src/billing-service.ts': `export class BillingService {
  constructor(private readonly repository: any) {}
  async getPlanById(id: string) {
    return this.repository.findPlanById(id);
  }
  async sweep() {
    for (const tenantId of await this.repository.listTenants()) {
      await this.repository.archive(tenantId);
    }
  }
  async getPlanWithSubscription(id: string) {
    const plan = await this.repository.findPlanById(id);
    return { plan, sub: await this.repository.findSubscriptionById(id) };
  }
}
`,
    },
    async (backendDir) => {
      const report = await runTenantIdCheck({ backendDir, platformScopes });
      return report.findings.filter((f) => f.severity === 'error');
    },
  );
  results.push({
    name: 'PR #579: platform-scoped ops and per-tenant fan-out pass; mixing in a tenant op still flags',
    ok:
      platformFindings.length === 1 && /getPlanWithSubscription/.test(platformFindings[0].message),
    message: JSON.stringify(platformFindings.map((f) => f.message)),
  });

  const staleFindings = await withBackendFixture(
    {
      'billing/src/billing-service.ts': `export class BillingService {
  constructor(private readonly repository: any) {}
  async getPlanById(id: string) {
    return this.repository.findPlanById(id);
  }
}
`,
    },
    async (backendDir) => {
      const report = await runTenantIdCheck({
        backendDir,
        platformScopes: [
          { ...platformScopes[0], operations: ['findPlanById', 'removedOp'] },
          { ...platformScopes[0], className: 'GoneService' },
        ],
      });
      return report.findings.filter((f) => f.severity === 'error');
    },
  );
  results.push({
    name: 'PR #579: stale platform-scope entries (unused op, missing class) are errors',
    ok:
      staleFindings.length === 2 &&
      staleFindings.some((f) => /never called via this\.repository: removedOp/.test(f.message)) &&
      staleFindings.some((f) => /GoneService does not match/.test(f.message)),
    message: JSON.stringify(staleFindings.map((f) => f.message)),
  });

  // PR #579: SQL scan sees tenant-bound wrappers, same-file callers and fragments.
  const sqlScope = await withBackendFixture(
    {
      '../../db/sql/001_fees.sql':
        'CREATE TABLE IF NOT EXISTS fee_invoices (\n  id uuid PRIMARY KEY,\n  tenant_id uuid NOT NULL\n);\n',
      'fees/src/pg-fee-store.ts': `import { withPgTenant } from '@proctira/database';
const INVOICE_SELECT = \`SELECT * FROM fee_invoices\`;
export class PgFeeStore {
  constructor(private readonly pool: any) {}
  private run<T>(tenantId: string, fn: (c: any) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }
  private q(tenantId: string, sql: string) {
    return withPgTenant(this.pool, tenantId, (c: any) => c.query(sql));
  }
  async viaRun(tenantId: string) {
    return this.run(tenantId, (c) => c.query('SELECT * FROM fee_invoices'));
  }
  async viaRow(row: { tenant_id: string }) {
    return this.q(String(row.tenant_id), 'SELECT id FROM fee_invoices WHERE id = 1');
  }
  async viaFragment(tenantId: string) {
    return this.q(tenantId, \`\${INVOICE_SELECT} ORDER BY id\`);
  }
  async unbound(pool: any) {
    return pool.query('SELECT count(*) FROM fee_invoices');
  }
}
async function loadInner(client: any) {
  return client.query('SELECT 1 FROM fee_invoices');
}
async function loadOuter(client: any) {
  return loadInner(client);
}
export async function entry(pool: any, tenantId: string) {
  return withPgTenant(pool, tenantId, (client: any) => loadOuter(client));
}
export async function exportedUnbound(client: any) {
  return client.query('SELECT 2 FROM fee_invoices');
}
`,
    },
    async (backendDir) => {
      const report = await runTenantIdCheck({
        backendDir,
        sqlDir: resolve(backendDir, '../../db/sql'),
      });
      return report.findings.filter(
        (f) => f.severity === 'error' && /SQL on tenant/.test(f.message),
      );
    },
  );
  results.push({
    name: 'PR #579: wrapper/caller/fragment scoping passes; unbound pool query and exported fn still flag',
    ok:
      sqlScope.length === 2 &&
      sqlScope.some((f) => f.line === 21) &&
      sqlScope.some((f) => f.line === 34),
    message: JSON.stringify(sqlScope.map((f) => `${f.line}: ${f.message}`)),
  });
  return results;
}
