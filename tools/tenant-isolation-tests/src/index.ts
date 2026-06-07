/**
 * @proctira/tenant-isolation-tests
 *
 * Multi-tenant isolation verification gate. The package exports the helper
 * surface used by every category test so that downstream contract tests
 * (in apps/services) can reuse the same arbitraries and leak detectors.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
export * from './helpers/index.js';
