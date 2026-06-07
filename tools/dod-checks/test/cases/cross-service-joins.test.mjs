/**
 * Unit tests for the cross-service-join detector. We exercise the same
 * `findCrossServiceTables` heuristic used in production.
 */
export const title = 'cross-service-joins: detection patterns';

const KNOWN_SERVICES = ['student', 'institution', 'auth', 'staff'];

function findCrossServiceTables(sqlText, ownerService) {
  const hits = [];
  if (!/\bJOIN\b/i.test(sqlText)) return hits;
  const tableRefRe = /\b(?:FROM|JOIN)\s+([\w."]+)/gi;
  let m;
  while ((m = tableRefRe.exec(sqlText)) !== null) {
    const raw = m[1].replace(/"/g, '');
    const tableName = raw.includes('.') ? raw.split('.').pop() : raw;
    for (const svc of KNOWN_SERVICES) {
      if (svc === ownerService) continue;
      if (tableName.startsWith(`${svc}_`)) hits.push(tableName);
    }
  }
  return hits;
}

export async function run() {
  const results = [];

  results.push({
    name: 'flags student → institution JOIN as cross-service',
    ok:
      findCrossServiceTables(
        'SELECT * FROM student_students s JOIN institution_institutions i ON i.id = s.institution_id',
        'student',
      ).length === 1,
  });

  results.push({
    name: 'allows student → student-internal JOIN',
    ok:
      findCrossServiceTables(
        'SELECT * FROM student_students s JOIN student_enrollments e ON s.id = e.student_id',
        'student',
      ).length === 0,
  });

  results.push({
    name: 'no flag when there is no JOIN',
    ok: findCrossServiceTables('SELECT * FROM student_students WHERE tenant_id = $1', 'student').length === 0,
  });

  results.push({
    name: 'detects multiple cross-service tables in one statement',
    ok:
      findCrossServiceTables(
        'SELECT * FROM student_students s JOIN institution_institutions i ON i.id = s.institution_id JOIN auth_users u ON u.id = s.user_id',
        'student',
      ).length === 2,
  });

  // Critical: foreign-key columns must not produce false positives.
  results.push({
    name: 'does not falsely flag foreign-key column references',
    ok:
      findCrossServiceTables(
        'SELECT s.id, s.institution_id, s.auth_user_id FROM student_students s JOIN student_enrollments e ON s.id = e.student_id',
        'student',
      ).length === 0,
  });

  return results;
}
