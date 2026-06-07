/**
 * Unit tests for the error-envelope check. We exercise the regex fallback
 * with both compliant and non-compliant payloads.
 */
export const title = 'error-envelope: detection patterns';

const REQUIRED = ['code', 'message', 'statusCode'];

function missingFromBody(body) {
  if (/\.\.\./.test(body)) return [];
  return REQUIRED.filter((f) => !new RegExp(`\\b${f}\\b`).test(body));
}

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

  return results;
}
