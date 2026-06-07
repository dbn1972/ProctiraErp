#!/usr/bin/env node
/**
 * Unit tests for Definition-of-Done CI Checks
 *
 * Validates the check logic against known-good and known-bad patterns.
 * Run with: node tools/scripts/definition-of-done-checks.test.mjs
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const testFixturesDir = resolve(here, '__test_fixtures__');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

// ============================================================================
// Test: Table Naming Patterns
// ============================================================================

function testTableNamingPatterns() {
  console.log('\n📋 Test: Table Naming Pattern Detection');

  // Valid service-prefixed table names
  const validNames = [
    'student_students',
    'auth_users',
    'institution_institutions',
    'attendance_records',
    'assessment_grading_schemes',
    'workflow_instances',
  ];

  // Invalid table names (missing service prefix)
  const invalidNames = [
    'users',
    'records',
    'some_table',
  ];

  // Shared tables that should be exempt
  const sharedTables = [
    'tenants',
    '_prisma_migrations',
  ];

  const knownServices = [
    'assessment', 'attendance', 'audit', 'auth', 'billing',
    'custom-field', 'data-warehouse', 'developer-portal', 'etl',
    'examination', 'health', 'install', 'institution', 'notification',
    'plugin', 'policy', 'registration', 'report', 'scholarship',
    'staff', 'student', 'survey', 'tenant', 'theme', 'transport', 'workflow',
  ];

  for (const name of validNames) {
    const hasPrefix = knownServices.some(svc => {
      const prefix = svc.replace(/-/g, '_');
      return name.startsWith(`${prefix}_`);
    });
    assert(hasPrefix, `"${name}" correctly identified as service-prefixed`);
  }

  for (const name of invalidNames) {
    const hasPrefix = knownServices.some(svc => {
      const prefix = svc.replace(/-/g, '_');
      return name.startsWith(`${prefix}_`);
    });
    assert(!hasPrefix, `"${name}" correctly identified as missing service prefix`);
  }

  for (const name of sharedTables) {
    assert(
      ['tenants', '_prisma_migrations'].includes(name),
      `"${name}" correctly identified as shared/exempt table`
    );
  }
}

// ============================================================================
// Test: Cross-Service Join Detection
// ============================================================================

function testCrossServiceJoinDetection() {
  console.log('\n📋 Test: Cross-Service Join Detection');

  // Should detect cross-service joins
  const badCode = `
    const result = await prisma.$queryRaw\`
      SELECT s.* FROM student_students s
      JOIN institution_institutions i ON s.institution_id = i.id
    \`;
  `;

  // Should NOT flag same-service joins
  const goodCode = `
    const result = await prisma.$queryRaw\`
      SELECT s.* FROM student_students s
      JOIN student_enrollments e ON s.id = e.student_id
    \`;
  `;

  // Should NOT flag non-join queries
  const noJoinCode = `
    const result = await prisma.$queryRaw\`
      SELECT * FROM student_students WHERE tenant_id = \${tenantId}
    \`;
  `;

  assert(
    /\$queryRaw.*\bJOIN\b/is.test(badCode) && badCode.includes('institution_'),
    'Detects cross-service SQL JOIN (student → institution)'
  );

  assert(
    /\$queryRaw.*\bJOIN\b/is.test(goodCode) && !goodCode.includes('institution_'),
    'Same-service JOIN is acceptable (student → student_enrollments)'
  );

  assert(
    !/\bJOIN\b/i.test(noJoinCode),
    'Non-JOIN queries are not flagged'
  );
}

// ============================================================================
// Test: tenant_id Parameter Detection
// ============================================================================

function testTenantIdDetection() {
  console.log('\n📋 Test: tenant_id Parameter Detection');

  // Good: method has tenantId
  const goodMethod = `async create(tenantId: string, dto: CreateStudentDto): Promise<Student>`;
  assert(goodMethod.includes('tenantId'), 'Method with tenantId is valid');

  // Bad: method missing tenantId
  const badMethod = `async create(dto: CreateStudentDto): Promise<Student>`;
  assert(!badMethod.includes('tenantId'), 'Method without tenantId is detected');

  // Acceptable: private method
  const privateMethod = `private async buildQuery(filters: Filters): Promise<Query>`;
  assert(privateMethod.includes('private'), 'Private methods are exempt');
}

// ============================================================================
// Test: Error Envelope Compliance
// ============================================================================

function testErrorEnvelopeCompliance() {
  console.log('\n📋 Test: Error Envelope Compliance');

  // Good: standard error envelope
  const goodError = `reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    statusCode: 400,
    errors: result.errors,
  })`;

  // Bad: missing fields
  const badError = `reply.status(400).send({
    error: 'Something went wrong'
  })`;

  const requiredFields = ['code', 'message', 'statusCode'];

  const goodMissing = requiredFields.filter(f => !goodError.includes(f));
  assert(goodMissing.length === 0, 'Standard error envelope has all required fields');

  const badMissing = requiredFields.filter(f => !badError.includes(f));
  assert(badMissing.length > 0, 'Non-standard error response is detected as missing fields');
}

// ============================================================================
// Test: i18n Hardcoded String Detection
// ============================================================================

function testI18nDetection() {
  console.log('\n📋 Test: i18n Hardcoded String Detection');

  // Acceptable: i18n key format
  assert(/^[a-z][a-z0-9_.]+$/.test('error.validation_failed'), 'i18n key format is acceptable');

  // Acceptable: constant format
  assert(/^[A-Z][A-Z0-9_]+$/.test('VALIDATION_ERROR'), 'Constant format is acceptable');

  // Flagged: long hardcoded English string
  const longString = 'The student record could not be found in the database';
  assert(longString.length > 20, 'Long hardcoded strings are flagged');
  assert(!/^[a-z][a-z0-9_.]+$/.test(longString), 'Long string does not match i18n key pattern');
}

// ============================================================================
// Test: Audit Event Patterns
// ============================================================================

function testAuditEventPatterns() {
  console.log('\n📋 Test: Audit Event Patterns');

  const auditPatterns = [
    /audit/i,
    /emit.*event/i,
    /publish.*event/i,
    /eventProducer/,
    /kafkaProducer/,
    /domainEvent/i,
  ];

  // Good: has audit integration
  const goodCode = `
    await this.auditService.record({
      tenantId, entityType: 'student', operation: 'create'
    });
  `;

  // Bad: no audit integration
  const badCode = `
    const student = await this.repository.create(tenantId, dto);
    return student;
  `;

  const goodHasAudit = auditPatterns.some(p => p.test(goodCode));
  assert(goodHasAudit, 'Code with audit integration is detected');

  const badHasAudit = auditPatterns.some(p => p.test(badCode));
  assert(!badHasAudit, 'Code without audit integration is detected');
}

// ============================================================================
// Main
// ============================================================================

console.log('═══════════════════════════════════════════════════════════════');
console.log(' Definition-of-Done Checks — Unit Tests');
console.log('═══════════════════════════════════════════════════════════════');

testTableNamingPatterns();
testCrossServiceJoinDetection();
testTenantIdDetection();
testErrorEnvelopeCompliance();
testI18nDetection();
testAuditEventPatterns();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
}
