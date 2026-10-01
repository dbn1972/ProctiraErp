/**
 * Fixture tests for the API schema presence check (PRC-L504). Runs the real
 * `runApiSchemaCheck` against a synthetic backend tree.
 */
import { runApiSchemaCheck } from '../../src/checks/api-schema.mjs';
import { withBackendFixture } from './fixture-utils.mjs';

export const title = 'api-schema: services with routes must publish Typebox schemas';

const PLAIN_ROUTE = `export async function feeRoutes(app: any) {
  app.post('/fees', async () => ({}));
}
`;

async function findingsFor(files) {
  return withBackendFixture(files, async (backendDir) => {
    const report = await runApiSchemaCheck({ backendDir, services: ['fees'] });
    return report.findings;
  });
}

export async function run() {
  const results = [];

  const flagged = await findingsFor({ 'fees/src/fee-routes.ts': PLAIN_ROUTE });
  results.push({
    name: 'service with routes and no Typebox schema is an error',
    ok:
      flagged.length === 1 && flagged[0].severity === 'error' && /"fees"/.test(flagged[0].message),
    message: JSON.stringify(flagged),
  });

  const schemaFile = await findingsFor({
    'fees/src/fee-routes.ts': PLAIN_ROUTE,
    'fees/src/fee-schemas.ts': `import { Type } from '@sinclair/typebox';
export const FeeBody = Type.Object({ amount: Type.Number() });
`,
  });
  results.push({
    name: 'dedicated Typebox schema file satisfies the check',
    ok: schemaFile.length === 0,
    message: JSON.stringify(schemaFile),
  });

  const legacy = await findingsFor({
    'fees/src/fee-routes.ts': `import { Type } from '@sinclair/typebox';
export const Body = Type.Object({});
${PLAIN_ROUTE}`,
    'fees/src/fee-schema.ts': `export const legacy = { type: 'object' };\n`,
  });
  results.push({
    name: 'inline Typebox passes but a non-Typebox schema file is warned',
    ok:
      legacy.length === 1 &&
      legacy[0].severity === 'warning' &&
      legacy.every((f) => f.severity !== 'error'),
    message: JSON.stringify(legacy),
  });

  const noRoutes = await findingsFor({ 'fees/src/fee-service.ts': 'export const x = 1;\n' });
  results.push({
    name: 'service without route files is skipped',
    ok: noRoutes.length === 0,
    message: JSON.stringify(noRoutes),
  });

  return results;
}
