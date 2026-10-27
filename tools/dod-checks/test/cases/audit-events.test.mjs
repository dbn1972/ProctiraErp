/**
 * Fixture tests for the audit-event emission check (PRC-L504). Runs the real
 * `runAuditEventsCheck` against a synthetic backend tree.
 */
import { runAuditEventsCheck } from '../../src/checks/audit-events.mjs';
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

async function warningsFor(files) {
  return withBackendFixture(files, async (backendDir) => {
    const report = await runAuditEventsCheck({ backendDir });
    return report.findings.filter((f) => f.severity === 'warning');
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
    ok: flagged.length === 1 && /"fees"/.test(flagged[0].message) && flagged[0].line === 2,
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

  // PRC-M410: the word "audit" without an audit call is not integration.
  const notEvidence = {
    'a comment mentioning audit': `export class FeeService {
  // TODO: audit this later
  async create(input: any) { return input; }
}
`,
    'a bare audit import': `import { AuditService } from '@proctira/audit';
export class FeeService {
  async create(input: any) { return input; }
}
`,
    'a string containing audit': `export class FeeService {
  async create(input: any) { const auditNote = 'audit'; return { ...input, note: auditNote }; }
}
`,
  };
  for (const [label, service] of Object.entries(notEvidence)) {
    const warned = await warningsFor({
      'fees/src/fee-routes.ts': WRITE_ROUTE,
      'fees/src/fee-service.ts': service,
    });
    results.push({
      name: `PRC-M410: ${label} is not audit evidence (still warns)`,
      ok: warned.length === 1,
      message: JSON.stringify(warned),
    });
  }

  const routeCall = await warningsFor({
    'fees/src/fee-routes.ts': `export async function feeRoutes(app: any) {
  app.post('/fees', async (req: any) => {
    const fee = await app.feeService.create(req.body);
    await recordAudit(req, { action: 'fee.create', id: fee.id });
    return fee;
  });
}
`,
    'fees/src/fee-service.ts': SILENT_SERVICE,
  });
  results.push({
    name: 'PRC-M410: an audit call in the route file satisfies the check',
    ok: routeCall.length === 0,
    message: JSON.stringify(routeCall),
  });

  // PRC-M410: a declaration (type signature or method body) is not a call.
  const declarations = {
    'an interface method signature': `interface Deps { recordAudit(e: unknown): Promise<void>; }
export class FeeService {
  constructor(private readonly deps: Deps) {}
  async create(input: any) { return input; }
}
`,
    'a declared-but-uncalled audit method': `export class FeeService {
  async audit(e: unknown) { return e; }
  async create(input: any) { return input; }
}
`,
  };
  for (const [label, service] of Object.entries(declarations)) {
    const warned = await warningsFor({
      'fees/src/fee-routes.ts': WRITE_ROUTE,
      'fees/src/fee-service.ts': service,
    });
    results.push({
      name: `PRC-M410: ${label} is not audit evidence (still warns)`,
      ok: warned.length === 1,
      message: JSON.stringify(warned),
    });
  }

  // PRC-M410: a regex literal containing a quote/backtick must not hide code.
  const regexLiteral = await warningsFor({
    'fees/src/fee-routes.ts': WRITE_ROUTE,
    'fees/src/fee-service.ts': `export class FeeService {
  constructor(private readonly auditService: any) {}
  async create(i: any) {
    const re = /\`/;
    await this.auditService.record(i);
    return re.test(i);
  }
}
`,
  });
  results.push({
    name: 'PRC-M410: an audit call after a regex literal with a backtick is still seen',
    ok: regexLiteral.length === 0,
    message: JSON.stringify(regexLiteral),
  });

  const division = await warningsFor({
    'fees/src/fee-routes.ts': WRITE_ROUTE,
    'fees/src/fee-service.ts': `export class FeeService {
  async create(total: number, x: any) {
    const half = total / 2; await recordAudit(x);
    return half;
  }
}
`,
  });
  results.push({
    name: 'PRC-M410: division is not read as a regex literal',
    ok: division.length === 0,
    message: JSON.stringify(division),
  });

  return results;
}
