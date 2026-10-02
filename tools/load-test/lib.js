/**
 * Pure helpers for the k6 load test (PRC-L176).
 *
 * Kept free of `k6/*` imports so they run under both k6 and `node --test`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate the seeded fixture document. Every tenant needs its own token and
 * real ids; at least two tenants are required so the cross-tenant scenario can
 * prove isolation. Throws (fails the run) instead of falling back to fake ids.
 *
 * @param {unknown} doc
 * @returns {{ tenants: Array<{ name: string, token: string, institutionId: string, classId: string, academicPeriodId: string, studentIds: string[] }> }}
 */
export function validateFixtures(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.tenants)) {
    throw new Error('load-test fixtures: expected { tenants: [...] }');
  }
  if (doc.tenants.length < 2) {
    throw new Error(
      'load-test fixtures: at least two tenants are required for cross-tenant checks',
    );
  }
  const names = new Set();
  for (const [i, t] of doc.tenants.entries()) {
    const where = `tenants[${i}]`;
    if (!t || typeof t !== 'object')
      throw new Error(`load-test fixtures: ${where} is not an object`);
    if (typeof t.name !== 'string' || !t.name)
      throw new Error(`load-test fixtures: ${where}.name missing`);
    if (names.has(t.name)) throw new Error(`load-test fixtures: duplicate tenant name ${t.name}`);
    names.add(t.name);
    if (typeof t.token !== 'string' || !t.token) {
      throw new Error(
        `load-test fixtures: ${where}.token missing (unauthenticated runs are not allowed)`,
      );
    }
    for (const key of ['institutionId', 'classId', 'academicPeriodId']) {
      if (!UUID_RE.test(String(t[key] ?? ''))) {
        throw new Error(`load-test fixtures: ${where}.${key} must be a seeded UUID`);
      }
    }
    if (!Array.isArray(t.studentIds) || t.studentIds.length === 0) {
      throw new Error(`load-test fixtures: ${where}.studentIds must list seeded students`);
    }
    for (const id of t.studentIds) {
      if (!UUID_RE.test(String(id)))
        throw new Error(`load-test fixtures: ${where}.studentIds has non-UUID ${id}`);
    }
  }
  const tokens = new Set(doc.tenants.map((t) => t.token));
  if (tokens.size !== doc.tenants.length) {
    throw new Error('load-test fixtures: each tenant must use its own token');
  }
  return doc;
}

/** Reads must succeed: only HTTP 200 counts; a 404 on a seeded id is a failure. */
export function isReadSuccess(status) {
  return status === 200;
}

/** A foreign tenant's id must be denied (403) or invisible (404); anything else is a leak or error. */
export function isCrossTenantDenied(status) {
  return status === 403 || status === 404;
}

/**
 * The bulk endpoint must return 201 with every submitted record either
 * recorded or updated.
 */
export function bulkAttendanceBodyOk(status, rawBody, expectedCount) {
  if (status !== 201) return false;
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (!body || !Array.isArray(body.recorded) || !Array.isArray(body.updated)) return false;
  return body.recorded.length + body.updated.length === expectedCount;
}

/**
 * Build the machine-readable summary (published as an artefact). `passed` is
 * false when any threshold was crossed, mirroring k6's own exit status.
 */
export function buildSummary(data) {
  const metrics = (data && data.metrics) || {};
  const thresholds = {};
  let passed = true;
  for (const [name, metric] of Object.entries(metrics)) {
    if (!metric || !metric.thresholds) continue;
    for (const [expr, result] of Object.entries(metric.thresholds)) {
      const ok = Boolean(result && result.ok);
      thresholds[`${name}: ${expr}`] = ok;
      if (!ok) passed = false;
    }
  }
  const p95 = metrics.http_req_duration?.values?.['p(95)'] ?? null;
  const errorRate = metrics.errors?.values?.rate ?? null;
  const crossTenantLeaks = metrics.cross_tenant_leaks?.values?.count ?? 0;
  if (crossTenantLeaks > 0) passed = false;
  return { schemaVersion: 1, passed, p95Ms: p95, errorRate, crossTenantLeaks, thresholds };
}
