/**
 * Unit tests for the error-envelope check. We exercise the regex fallback
 * with both compliant and non-compliant payloads.
 *
 * PRC-L375: fixture cases run the real `runErrorEnvelopeCheck` (AST path) and
 * the exported regex fallback, including raw Error objects sent as a reply.
 */
import * as errorEnvelope from '../../src/checks/error-envelope.mjs';
import { Report } from '../../src/lib/reporter.mjs';
import { withBackendFixture } from './fixture-utils.mjs';

export const title = 'error-envelope: detection patterns';

const REQUIRED = ['code', 'message', 'statusCode'];

function missingFromBody(body) {
  if (/\.\.\./.test(body)) return [];
  return REQUIRED.filter((f) => !new RegExp(`\\b${f}\\b`).test(body));
}

const RAW_ERROR = /raw Error object/;

/** Error findings the real check reports for a single fixture route file. */
async function errorsFor(source) {
  return withBackendFixture({ 'svc/src/svc-routes.ts': source }, async (backendDir) => {
    const report = await errorEnvelope.runErrorEnvelopeCheck({ backendDir });
    return report.findings.filter((f) => f.severity === 'error');
  });
}

const route = (body) => `export async function svcRoutes(app: any) {
  app.post('/x', async (req: any, reply: any) => {
${body}
  });
}
`;

export async function run() {
  const results = [];

  const compliant = `code: 'VAL', message: 'failed', statusCode: 400, errors: []`;
  results.push({
    name: 'compliant envelope reports no missing fields',
    ok: missingFromBody(compliant).length === 0,
  });

  const missingCode = `message: 'failed', statusCode: 400`;
  results.push({
    name: 'envelope without `code` is flagged',
    ok: missingFromBody(missingCode).includes('code'),
  });

  const spread = `...errorEnvelope, additional: true`;
  results.push({
    name: 'spread envelope is exempt (presumed compliant)',
    ok: missingFromBody(spread).length === 0,
  });

  // PRC-L375: raw Error objects sent from a handler bypass the envelope.
  const caught = await errorsFor(
    route(`    try {
      return await doWork();
    } catch (err) {
      return reply.status(500).send(err);
    }`),
  );
  results.push({
    name: 'PRC-L375: reply.status(500).send(<catch variable>) is flagged',
    ok: caught.length === 1 && RAW_ERROR.test(caught[0].message),
    message: JSON.stringify(caught),
  });

  const newError = await errorsFor(route(`    return reply.status(400).send(new Error('bad'));`));
  results.push({
    name: 'PRC-L375: reply.status(400).send(new Error(...)) is flagged',
    ok: newError.length === 1 && RAW_ERROR.test(newError[0].message),
    message: JSON.stringify(newError),
  });

  const bare = await errorsFor(
    route(`    try {
      return await doWork();
    } catch (e) {
      return reply.send(e);
    }`),
  );
  results.push({
    name: 'PRC-L375: bare reply.send(<catch variable>) is flagged',
    ok: bare.length === 1 && RAW_ERROR.test(bare[0].message),
    message: JSON.stringify(bare),
  });

  const typedHelper = await errorsFor(`function sendError(
  reply: any,
  error: { code: string; message: string; statusCode: number },
) {
  return reply.status(error.statusCode).send(error);
}
export async function svcRoutes(app: any) {
  app.post('/x', async (_req: any, reply: any) =>
    sendError(reply, { code: 'X', message: 'm', statusCode: 400 }),
  );
}
`);
  results.push({
    name: 'PRC-L375: typed envelope helper parameter is not flagged',
    ok: typedHelper.length === 0,
    message: JSON.stringify(typedHelper),
  });

  const literalOk = await errorsFor(
    route(
      `    return reply.status(404).send({ code: 'NF', message: 'missing', statusCode: 404 });`,
    ),
  );
  results.push({
    name: 'PRC-L375: compliant literal envelope is not flagged (real check)',
    ok: literalOk.length === 0,
    message: JSON.stringify(literalOk),
  });

  const literalBad = await errorsFor(
    route(`    return reply.status(404).send({ message: 'missing', statusCode: 404 });`),
  );
  results.push({
    name: 'PRC-L375: literal envelope missing `code` is flagged (real check)',
    ok: literalBad.length === 1 && /code/.test(literalBad[0].message),
    message: JSON.stringify(literalBad),
  });

  const regexReport = new Report('error-envelope', 'regex fallback');
  const checkViaRegex = errorEnvelope.checkViaRegex;
  if (typeof checkViaRegex === 'function') {
    checkViaRegex(
      `reply.status(500).send(new Error('boom'));\nreply.status(400).send(new TypeError('t'));`,
      'packages/backend/svc/src/svc-routes.ts',
      regexReport,
    );
  }
  const regexErrors = regexReport.findings.filter(
    (f) => f.severity === 'error' && RAW_ERROR.test(f.message),
  );
  results.push({
    name: 'PRC-L375: regex fallback flags .send(new <Builtin>Error(...))',
    ok: regexErrors.length === 2,
    message: `exported=${typeof checkViaRegex} findings=${JSON.stringify(regexReport.findings)}`,
  });

  return results;
}
