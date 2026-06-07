/**
 * Unit tests for the i18n hardcoded-string detector.
 */
export const title = 'i18n-readiness: acceptable string heuristics';

const ACCEPTABLE_PATTERNS = [
  /^[a-z][a-z0-9_]+(\.[a-z0-9_]+)+$/,
  /^[A-Z][A-Z0-9_]+$/,
  /^(ok|success|created|deleted|updated|accepted|noContent)$/i,
];

function isAcceptable(value) {
  if (value.length <= 20) return true;
  return ACCEPTABLE_PATTERNS.some((p) => p.test(value));
}

export async function run() {
  const results = [];
  results.push({ name: 'dotted i18n key is acceptable', ok: isAcceptable('error.validation_failed') });
  results.push({ name: 'upper-case constant is acceptable', ok: isAcceptable('VALIDATION_ERROR_CODE') });
  results.push({ name: 'short status word is acceptable', ok: isAcceptable('created') });
  results.push({
    name: 'long English sentence is flagged',
    ok: !isAcceptable('The student record could not be located in the database'),
  });
  return results;
}
