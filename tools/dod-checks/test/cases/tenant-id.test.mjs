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
  return results;
}
