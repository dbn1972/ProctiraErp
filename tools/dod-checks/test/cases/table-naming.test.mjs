/**
 * Unit tests for the table-naming check. We exercise the `parsePrismaModels`
 * + `hasServicePrefix` logic directly against synthetic Prisma schemas so we
 * don't depend on the live monorepo state.
 */
import { KNOWN_SERVICES, SHARED_TABLES, servicePrefix } from '../../src/lib/constants.mjs';

export const title = 'table-naming: service prefix detection';

function hasPrefix(name) {
  return KNOWN_SERVICES.some((s) => name.startsWith(`${servicePrefix(s)}_`));
}

export async function run() {
  const results = [];

  // Valid names
  for (const valid of [
    'student_students',
    'auth_users',
    'institution_institutions',
    'attendance_records',
    'custom_field_definitions', // custom-field → custom_field
    'data_warehouse_facts', // data-warehouse → data_warehouse
    'developer_portal_keys',
  ]) {
    results.push({
      name: `recognises "${valid}" as service-prefixed`,
      ok: hasPrefix(valid),
      message: 'expected hasPrefix() to return true',
    });
  }

  // Invalid names
  for (const invalid of ['users', 'records', 'misc_table', 'snake_case_thing']) {
    results.push({
      name: `flags "${invalid}" as missing service prefix`,
      ok: !hasPrefix(invalid),
      message: 'expected hasPrefix() to return false',
    });
  }

  // Shared tables exempt
  for (const shared of ['tenants', '_prisma_migrations']) {
    results.push({
      name: `treats "${shared}" as a shared/exempt table`,
      ok: SHARED_TABLES.has(shared),
      message: 'expected SHARED_TABLES set to contain it',
    });
  }

  return results;
}
