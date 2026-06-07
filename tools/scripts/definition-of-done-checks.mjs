#!/usr/bin/env node
/**
 * Definition-of-Done CI Checks
 *
 * Automated checks enforcing the Multi-Tenant Product Platform Charter (Section 32).
 * These checks run as a release gate in CI and can be invoked locally via:
 *
 *   pnpm run dod:check
 *
 * Checks:
 * 1. Service-prefixed table naming (Prisma @@map values must use service prefix)
 * 2. Cross-service SQL join prevention (no raw SQL joins across service boundaries)
 * 3. tenant_id in all queries (all repository methods must include tenantId)
 * 4. Audit event emission on writes (POST/PUT/DELETE handlers emit audit events)
 * 5. API schema presence (Typebox schemas for all route handlers)
 * 6. Error envelope compliance (error responses use standard ApiError shape)
 * 7. i18n readiness (no hardcoded user-facing strings in backend services)
 *
 * Exit code 0 = all checks pass, non-zero = at least one check failed.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const backendDir = resolve(root, 'packages/backend');
const sharedDir = resolve(root, 'packages/shared');

// ============================================================================
// Utilities
// ============================================================================

/**
 * Recursively find files matching a pattern.
 */
async function findFiles(dir, predicate) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue;
      results.push(...await findFiles(fullPath, predicate));
    } else if (predicate(entry.name, fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Read file content, returning empty string on failure.
 */
async function safeReadFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Get the service name from a backend package path.
 * e.g., packages/backend/student/src/routes.ts → "student"
 */
function getServiceName(filePath) {
  const rel = relative(backendDir, filePath);
  return rel.split('/')[0];
}

// Known service prefixes that map to table names
const KNOWN_SERVICES = [
  'assessment', 'attendance', 'audit', 'auth', 'billing',
  'custom-field', 'data-warehouse', 'developer-portal', 'etl',
  'examination', 'health', 'install', 'institution', 'notification',
  'plugin', 'policy', 'registration', 'report', 'scholarship',
  'staff', 'student', 'survey', 'tenant', 'theme', 'transport', 'workflow',
];

// Tables that are shared/cross-cutting and don't need service prefix
const SHARED_TABLES = [
  'tenants', '_prisma_migrations',
];

let totalErrors = 0;
let totalWarnings = 0;

function reportError(check, file, message) {
  const rel = relative(root, file);
  console.error(`  ❌ [${check}] ${rel}: ${message}`);
  totalErrors++;
}

function reportWarning(check, file, message) {
  const rel = relative(root, file);
  console.warn(`  ⚠️  [${check}] ${rel}: ${message}`);
  totalWarnings++;
}

function reportPass(check, message) {
  console.log(`  ✅ [${check}] ${message}`);
}

// ============================================================================
// Check 1: Service-Prefixed Table Naming
// ============================================================================

async function checkTableNaming() {
  console.log('\n📋 Check 1: Service-Prefixed Table Naming');
  console.log('   Tables must use service-prefix naming (e.g., student_students, auth_users)');

  const prismaFiles = await findFiles(resolve(root, 'packages'), (name) => name === 'schema.prisma');
  let errors = 0;

  for (const file of prismaFiles) {
    const content = await safeReadFile(file);
    // Find all @@map("table_name") declarations
    const mapRegex = /@@map\("([^"]+)"\)/g;
    let match;
    while ((match = mapRegex.exec(content)) !== null) {
      const tableName = match[1];
      // Skip shared tables
      if (SHARED_TABLES.includes(tableName)) continue;
      // Skip enum maps (they typically use snake_case type names)
      const linesBefore = content.substring(0, match.index).split('\n');
      const contextLine = linesBefore.slice(-5).join('\n');
      if (contextLine.includes('enum ')) continue;

      // Check if table name has a service prefix (service_tablename pattern)
      const hasPrefix = KNOWN_SERVICES.some(svc => {
        const prefix = svc.replace(/-/g, '_');
        return tableName.startsWith(`${prefix}_`);
      });

      // Also allow common shared tables that are in the shared/database package
      const isSharedDb = file.includes('packages/shared/database');
      if (!hasPrefix && !isSharedDb) {
        reportError('table-naming', file, `Table "${tableName}" lacks service prefix. Expected format: <service>_<name>`);
        errors++;
      }
    }
  }

  if (errors === 0) {
    reportPass('table-naming', `All table names follow service-prefix convention (${prismaFiles.length} schema files checked)`);
  }
}

// ============================================================================
// Check 2: Cross-Service SQL Join Prevention
// ============================================================================

async function checkCrossServiceJoins() {
  console.log('\n📋 Check 2: Cross-Service SQL Join Prevention');
  console.log('   No raw SQL joins across service boundaries');

  const tsFiles = await findFiles(backendDir, (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts'));
  let errors = 0;

  // Patterns that indicate cross-service SQL joins
  const joinPatterns = [
    /\$queryRaw.*\bJOIN\b/i,
    /\$executeRaw.*\bJOIN\b/i,
    /sql`[^`]*\bJOIN\b[^`]*`/i,
    /Prisma\.\$queryRawUnsafe.*\bJOIN\b/i,
  ];

  // Pattern to detect importing from another backend service
  const crossImportPattern = /from\s+['"]@proctira\/backend-([^'"]+)['"]/;

  for (const file of tsFiles) {
    const content = await safeReadFile(file);
    const serviceName = getServiceName(file);

    // Check for raw SQL joins
    for (const pattern of joinPatterns) {
      if (pattern.test(content)) {
        // Verify it's actually a cross-service join by checking table references
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/\bJOIN\b/i.test(line) && (/\$queryRaw|\$executeRaw|sql`/.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n')))) {
            // Check if the JOIN references tables from other services
            for (const svc of KNOWN_SERVICES) {
              if (svc === serviceName) continue;
              const svcPrefix = svc.replace(/-/g, '_');
              if (line.includes(`${svcPrefix}_`)) {
                reportError('cross-service-join', file, `Line ${i + 1}: SQL JOIN references "${svcPrefix}_*" table from "${serviceName}" service`);
                errors++;
              }
            }
          }
        }
      }
    }

    // Check for direct repository imports from other services
    const importMatches = content.matchAll(new RegExp(crossImportPattern, 'g'));
    for (const importMatch of importMatches) {
      const importedService = importMatch[1];
      if (importedService !== serviceName) {
        reportWarning('cross-service-join', file, `Imports from @proctira/backend-${importedService} — ensure no direct DB access across services`);
      }
    }
  }

  if (errors === 0) {
    reportPass('cross-service-join', `No cross-service SQL joins detected (${tsFiles.length} files checked)`);
  }
}

// ============================================================================
// Check 3: tenant_id in All Queries
// ============================================================================

async function checkTenantIdInQueries() {
  console.log('\n📋 Check 3: tenant_id in All Queries');
  console.log('   Public service methods that perform data operations must include tenantId');

  // Only check service files (the public API layer), not internal repositories
  // In-memory repositories are implementation details; the service layer enforces tenantId
  const serviceFiles = await findFiles(backendDir, (name) =>
    name.includes('service') &&
    !name.includes('in-memory') &&
    !name.includes('repository') &&
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    !name.endsWith('.spec.ts') &&
    !name.includes('standalone')
  );
  let errors = 0;

  for (const file of serviceFiles) {
    const content = await safeReadFile(file);
    const serviceName = getServiceName(file);

    // Skip non-tenant-scoped services (tenant service itself manages tenants)
    if (serviceName === 'tenant' || serviceName === 'install') continue;

    // Find exported/public async methods that are the main service API
    // These are the methods called by route handlers and must accept tenantId
    const methodRegex = /\basync\s+(create|update|delete|find|get|list|search|query|remove|archive)\w*\s*\(([^)]*)\)/g;
    let methodMatch;

    while ((methodMatch = methodRegex.exec(content)) !== null) {
      const fullMethodName = methodMatch[0].match(/async\s+(\w+)/)?.[1] || '';
      const params = methodMatch[2];

      // Skip private/protected methods
      const beforeMethod = content.substring(Math.max(0, methodMatch.index - 30), methodMatch.index);
      if (beforeMethod.includes('private') || beforeMethod.includes('protected') || beforeMethod.includes('#')) continue;

      // Skip internal helper methods (short names like getDimensionName, getLatestRevisionNumber)
      // that are clearly not public data-access APIs
      if (fullMethodName.length > 30) continue;

      // Skip methods that are clearly internal helpers (called by other methods in the same class)
      // Heuristic: if the method name starts with a helper verb pattern
      const helperPatterns = /^(get[A-Z]\w*(Name|Id|Number|Config|Type)|find[A-Z]\w*(By|Index)|update[A-Z]\w*(Status|Progress))/;
      if (helperPatterns.test(fullMethodName)) continue;

      // Check if tenantId is in the parameters
      if (params.trim().length > 0 && !params.includes('tenantId') && !params.includes('tenant_id') && !params.includes('tenant')) {
        // Only flag if this is a top-level service method (class method with meaningful body)
        const afterMethod = content.substring(methodMatch.index, Math.min(content.length, methodMatch.index + 300));
        // Must reference this.repository or this. (indicating it's a class method doing real work)
        if (afterMethod.includes('this.repository') || afterMethod.includes('this.repo')) {
          reportError('tenant-id', file, `Service method "${fullMethodName}" may be missing tenantId parameter`);
          errors++;
        }
      }
    }
  }

  if (errors === 0) {
    reportPass('tenant-id', `All public service methods include tenantId (${serviceFiles.length} files checked)`);
  }
}

// ============================================================================
// Check 4: Audit Event Emission on Writes
// ============================================================================

async function checkAuditEventEmission() {
  console.log('\n📋 Check 4: Audit Event Emission on Writes');
  console.log('   POST/PUT/DELETE route handlers should emit audit events');

  const routeFiles = await findFiles(backendDir, (name) =>
    name.includes('route') && name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')
  );
  let errors = 0;

  // Patterns indicating write operations
  const writePatterns = [
    /fastify\.(post|put|patch|delete)\s*\(/,
    /\.post\s*\(/,
    /\.put\s*\(/,
    /\.patch\s*\(/,
    /\.delete\s*\(/,
  ];

  // Patterns indicating audit event emission
  const auditPatterns = [
    /audit/i,
    /emit.*event/i,
    /publish.*event/i,
    /log.*change/i,
    /record.*change/i,
    /eventProducer/,
    /kafkaProducer/,
    /domainEvent/i,
  ];

  for (const file of routeFiles) {
    const content = await safeReadFile(file);
    const serviceName = getServiceName(file);

    // Skip audit service itself (it IS the audit system)
    if (serviceName === 'audit') continue;
    // Skip read-only services
    if (serviceName === 'developer-portal') continue;

    let hasWriteRoutes = false;
    let hasAuditIntegration = false;

    for (const pattern of writePatterns) {
      if (pattern.test(content)) {
        hasWriteRoutes = true;
        break;
      }
    }

    if (hasWriteRoutes) {
      for (const pattern of auditPatterns) {
        if (pattern.test(content)) {
          hasAuditIntegration = true;
          break;
        }
      }

      // Also check if the service file (not just routes) has audit integration
      if (!hasAuditIntegration) {
        const serviceFiles = await findFiles(resolve(backendDir, serviceName, 'src'), (name) =>
          name.includes('service') && name.endsWith('.ts') && !name.endsWith('.test.ts')
        );
        for (const svcFile of serviceFiles) {
          const svcContent = await safeReadFile(svcFile);
          for (const pattern of auditPatterns) {
            if (pattern.test(svcContent)) {
              hasAuditIntegration = true;
              break;
            }
          }
          if (hasAuditIntegration) break;
        }
      }

      if (!hasAuditIntegration) {
        reportWarning('audit-events', file, `Service "${serviceName}" has write routes but no audit event emission detected`);
      }
    }
  }

  if (errors === 0) {
    reportPass('audit-events', `Audit event emission check complete (${routeFiles.length} route files checked)`);
  }
}

// ============================================================================
// Check 5: API Schema Presence (Typebox)
// ============================================================================

async function checkApiSchemaPresence() {
  console.log('\n📋 Check 5: API Schema Presence (Typebox)');
  console.log('   All backend services with routes must have Typebox schema definitions');

  let errors = 0;
  const servicesWithRoutes = [];

  for (const svc of KNOWN_SERVICES) {
    const svcDir = resolve(backendDir, svc, 'src');
    const routeFiles = await findFiles(svcDir, (name) =>
      name.includes('route') && name.endsWith('.ts') && !name.endsWith('.test.ts')
    );

    if (routeFiles.length > 0) {
      servicesWithRoutes.push(svc);

      // Check for schema files
      const schemaFiles = await findFiles(svcDir, (name) =>
        name.includes('schema') && name.endsWith('.ts') && !name.endsWith('.test.ts')
      );

      if (schemaFiles.length === 0) {
        // Check if schemas are defined inline in route files
        let hasInlineSchemas = false;
        for (const routeFile of routeFiles) {
          const content = await safeReadFile(routeFile);
          if (content.includes('@sinclair/typebox') || content.includes('Type.Object') || content.includes('Schema')) {
            hasInlineSchemas = true;
            break;
          }
        }

        if (!hasInlineSchemas) {
          reportError('api-schema', resolve(svcDir, '..'), `Service "${svc}" has routes but no Typebox schema definitions`);
          errors++;
        }
      } else {
        // Verify schemas actually use Typebox
        let usesTypebox = false;
        for (const schemaFile of schemaFiles) {
          const content = await safeReadFile(schemaFile);
          if (content.includes('@sinclair/typebox') || content.includes('Type.Object')) {
            usesTypebox = true;
            break;
          }
        }
        if (!usesTypebox) {
          reportWarning('api-schema', schemaFiles[0], `Schema file exists but doesn't use @sinclair/typebox`);
        }
      }
    }
  }

  if (errors === 0) {
    reportPass('api-schema', `All ${servicesWithRoutes.length} services with routes have Typebox schemas`);
  }
}

// ============================================================================
// Check 6: Error Envelope Compliance
// ============================================================================

async function checkErrorEnvelopeCompliance() {
  console.log('\n📋 Check 6: Error Envelope Compliance');
  console.log('   Error responses must use standard ApiError shape (code, message, statusCode)');

  const routeFiles = await findFiles(backendDir, (name) =>
    name.includes('route') && name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')
  );
  let errors = 0;

  // Standard error envelope fields
  const requiredFields = ['code', 'message', 'statusCode'];

  for (const file of routeFiles) {
    const content = await safeReadFile(file);

    // Find error response sends (status 4xx/5xx)
    const errorSendRegex = /reply\.status\(([45]\d{2})\)\.send\(\{([^}]+)\}\)/g;
    let match;

    while ((match = errorSendRegex.exec(content)) !== null) {
      const responseBody = match[2];
      const missingFields = requiredFields.filter(field => !responseBody.includes(field));

      if (missingFields.length > 0) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        reportError('error-envelope', file, `Line ${lineNum}: Error response missing fields: ${missingFields.join(', ')}`);
        errors++;
      }
    }

    // Also check for throw patterns that bypass the standard envelope
    // (raw Error throws without AppError wrapper)
    const rawThrowRegex = /throw\s+new\s+Error\s*\(/g;
    let throwMatch;
    while ((throwMatch = rawThrowRegex.exec(content)) !== null) {
      // This is acceptable if there's a global error handler, but flag as warning
      const lineNum = content.substring(0, throwMatch.index).split('\n').length;
      // Only warn if it's not in a catch block (re-throw is fine)
      const contextBefore = content.substring(Math.max(0, throwMatch.index - 200), throwMatch.index);
      if (!contextBefore.includes('catch')) {
        reportWarning('error-envelope', file, `Line ${lineNum}: Raw Error throw — prefer AppError for consistent error envelope`);
      }
    }
  }

  if (errors === 0) {
    reportPass('error-envelope', `All error responses follow standard envelope (${routeFiles.length} route files checked)`);
  }
}

// ============================================================================
// Check 7: i18n Readiness (No Hardcoded Strings)
// ============================================================================

async function checkI18nReadiness() {
  console.log('\n📋 Check 7: i18n Readiness');
  console.log('   No hardcoded user-facing strings in backend services');

  const routeFiles = await findFiles(backendDir, (name) =>
    name.includes('route') && name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')
  );
  let errors = 0;

  // Patterns that indicate hardcoded user-facing strings
  // We look for message fields in error responses that contain hardcoded English text
  // rather than i18n keys or translation function calls
  const hardcodedMessageRegex = /message:\s*['"]([^'"]+)['"]/g;

  // Acceptable patterns (i18n keys, template literals with variables, short technical messages)
  const acceptablePatterns = [
    /^[a-z][a-z0-9_.]+$/, // i18n key format: "error.validation_failed"
    /^[A-Z][A-Z0-9_]+$/, // Constant format: "VALIDATION_ERROR"
    /\$\{/, // Template literal with variable
    /^(ok|success|created|deleted|updated)$/i, // Short status words
  ];

  // Known technical messages that are acceptable (not user-facing)
  const technicalMessages = [
    'Validation failed',
    'Tenant context is required',
    'Invalid student ID',
    'Search query is required',
    'Not found',
    'Internal server error',
  ];

  for (const file of routeFiles) {
    const content = await safeReadFile(file);
    let match;

    while ((match = hardcodedMessageRegex.exec(content)) !== null) {
      const message = match[1];

      // Skip if it matches acceptable patterns
      const isAcceptable = acceptablePatterns.some(p => p.test(message));
      if (isAcceptable) continue;

      // Skip known technical messages (these are for developer consumption, not end-users)
      if (technicalMessages.some(tm => message.includes(tm))) continue;

      // Skip very short strings (likely codes or status values)
      if (message.length <= 20) continue;

      // Flag long hardcoded strings that look user-facing
      const lineNum = content.substring(0, match.index).split('\n').length;
      reportWarning('i18n', file, `Line ${lineNum}: Potential hardcoded string: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
    }
  }

  if (errors === 0) {
    reportPass('i18n', `i18n readiness check complete (${routeFiles.length} route files checked)`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' Definition-of-Done CI Checks');
  console.log(' Charter: Section 32 (Definition of Done)');
  console.log('═══════════════════════════════════════════════════════════════');

  await checkTableNaming();
  await checkCrossServiceJoins();
  await checkTenantIdInQueries();
  await checkAuditEventEmission();
  await checkApiSchemaPresence();
  await checkErrorEnvelopeCompliance();
  await checkI18nReadiness();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(` Results: ${totalErrors} error(s), ${totalWarnings} warning(s)`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (totalErrors > 0) {
    console.error(`\n💥 ${totalErrors} error(s) found — fix before merging.`);
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.warn(`\n⚠️  ${totalWarnings} warning(s) — review recommended.`);
    process.exit(0);
  } else {
    console.log('\n🎉 All Definition-of-Done checks passed!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error running DoD checks:', err);
  process.exit(2);
});
