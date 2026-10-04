/**
 * Fixture tests for the tenant-id threading check (PRC-L504). Runs the real
 * `runTenantIdCheck` against a synthetic backend tree.
 */
import { runTenantIdCheck } from '../../src/checks/tenant-id.mjs';
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
    name: 'helper names, private methods and tenant bootstrap service are exempt',
    ok: exempt.length === 0,
    message: JSON.stringify(exempt.map((f) => f.message)),
  });

  return results;
}
