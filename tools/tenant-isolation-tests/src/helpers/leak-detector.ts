/**
 * Cross-tenant leak detection helpers.
 *
 * The verification gate must FAIL whenever any artefact (record, message,
 * cache entry, file path, etc.) carries a tenant id different from the
 * tenant that requested it. These assertion helpers make that intent
 * explicit at every call site so individual tests cannot silently swallow
 * a leak by checking only counts.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */

/**
 * Failure raised when a cross-tenant leak is detected. Using a custom
 * error type makes it trivial to grep CI logs for tenancy regressions.
 */
export class TenantIsolationLeakError extends Error {
  public readonly code = 'TENANT_ISOLATION_LEAK';

  constructor(
    public readonly category: string,
    public readonly expectedTenantId: string,
    public readonly leakedTenantId: string,
    public readonly evidence: unknown,
  ) {
    super(
      `Tenant isolation leak detected in ${category}: ` +
        `expected tenantId=${expectedTenantId} but found tenantId=${leakedTenantId}`,
    );
    this.name = 'TenantIsolationLeakError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Asserts that every record returned for `expectedTenantId` actually carries
 * that tenant id. Throws `TenantIsolationLeakError` on the first foreign id.
 */
export function assertNoForeignTenant(
  category: string,
  expectedTenantId: string,
  records: ReadonlyArray<{ tenantId: string }>,
): void {
  for (const record of records) {
    if (record.tenantId !== expectedTenantId) {
      throw new TenantIsolationLeakError(
        category,
        expectedTenantId,
        record.tenantId,
        record,
      );
    }
  }
}

/**
 * Asserts that a string artefact (topic name, queue name, file path, cache
 * key) does not contain any of the foreign tenant ids.
 */
export function assertNoForeignTenantInString(
  category: string,
  expectedTenantId: string,
  value: string,
  foreignTenantIds: readonly string[],
): void {
  for (const foreign of foreignTenantIds) {
    if (foreign === expectedTenantId) continue;
    if (value.includes(foreign)) {
      throw new TenantIsolationLeakError(category, expectedTenantId, foreign, value);
    }
  }
}

/**
 * Asserts that a string artefact actually carries the expected tenant id.
 * Used as a positive check alongside `assertNoForeignTenantInString`.
 */
export function assertContainsTenant(
  category: string,
  expectedTenantId: string,
  value: string,
): void {
  if (!value.includes(expectedTenantId)) {
    throw new TenantIsolationLeakError(
      category,
      expectedTenantId,
      '<<missing>>',
      value,
    );
  }
}
