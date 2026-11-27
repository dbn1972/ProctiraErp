/**
 * Preconditions the race scenarios depend on, checked once per run.
 *
 * Seeded students: the Sunrise seed (db/seeds/006) creates student ids with
 * uuid_generate_v5, valid UUIDs stored in uuid columns and enrolled. The race
 * scenarios need them as exam candidates and hostel residents; a schema that
 * accepts only version-4 ids refuses every one of them with 400.
 */
import { S, UUID_V4_RE, isoDay, uid, type RaceEnv } from './env.js';
import { createExam } from './seats.js';
export interface CompatCase {
  id: string;
  module: string;
  run(env: RaceEnv): Promise<{ ok: boolean; detail: string }>;
}
async function seededNonV4Student(env: RaceEnv): Promise<string> {
  const all = await env.q<{ id: string }>(
    `SELECT student_id::text AS id FROM enrollments
      WHERE tenant_id = $1 AND status = 'ENROLLED' AND institution_id = $2 ORDER BY 1`,
    [S, env.institutionId],
  );
  const id = all.map((r) => r.id).find((x) => !UUID_V4_RE.test(x));
  if (!id) throw new Error('no seeded non-v4 student id');
  return id;
}
export const COMPAT_CASES: CompatCase[] = [
  {
    id: 'compat:seeded-student-id:exam-candidate',
    module: 'examination',
    async run(env) {
      const studentId = await seededNonV4Student(env);
      const exam = await createExam(env);
      const r = await env.gateways[0]!.as(env.user('examinations_officer')).post(
        `/api/v1/examinations/${exam.id}/candidates`,
        { studentId, centerId: exam.centerId, subjectIds: [exam.subjectId] },
      );
      return {
        ok: r.status === 201,
        detail: `register enrolled seeded student ${studentId} -> ${r.status} ${r.text.slice(0, 160)}`,
      };
    },
  },
  {
    id: 'compat:seeded-student-id:hostel-assignment',
    module: 'hostel',
    async run(env) {
      const studentId = await seededNonV4Student(env);
      const api = env.gateways[0]!.as(env.user('hostel_admin'));
      const id = async (path: string, body: Record<string, unknown>) =>
        ((await api.post(path, body)).json as { id?: string } | undefined)?.id ?? '';
      const hostelId = await id('/api/v1/hostel', {
        name: `aitest t05 compat ${uid()}`,
        code: `C5${uid()}`,
      });
      const blockId = await id('/api/v1/hostel/blocks', { hostelId, name: 'Block C' });
      const roomId = await id('/api/v1/hostel/rooms', { blockId, roomNumber: '1', capacity: 1 });
      const bedId = await id('/api/v1/hostel/beds', { roomId, bedLabel: 'C1' });
      const r = await api.post('/api/v1/hostel/assignments', {
        studentId,
        bedId,
        startDate: isoDay(env.dayBase),
      });
      // A seeded student may already hold a bed from an earlier run on a kept stack (409).
      return {
        ok: r.status === 201 || r.status === 409,
        detail: `assign seeded student ${studentId} -> ${r.status} ${r.text.slice(0, 160)}`,
      };
    },
  },
];
