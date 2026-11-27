/**
 * Concurrent marks entry.
 *
 * Gradebook (PUT /gradebook/entries, PRC-M264): the update is a compare-and-
 * set under a row lock (expected updatedAt), so of several teachers editing
 * one mark at once some win and the others get 409; parallel creates of one
 * mark make one row. The database trigger writes grade_change_audit for each
 * committed write (db/sql/071). No lost update means the audit edges form one
 * chain from the starting score to the stored score: no two committed edits
 * started from the same score, and there is one edge per successful write.
 *
 * Exam double entry (POST /examinations/:id/marks/entries): one row per
 * (candidate, subject, entryNo); a second entry is 409.
 */
import { allOf, checkStatuses, expectEq, type Check } from '../race.js';

import { S, statusesOf, uid, type RaceEnv, type Variant } from './env.js';
import { createExam, registerCandidates } from './seats.js';
async function sectionWithStudent(env: RaceEnv) {
  const api = env.gateways[0]!.as(env.user('timetable_officer'));
  const sec = await api.post('/api/v1/timetable/sections', {
    institutionId: env.institutionId,
    academicPeriodId: env.academicPeriodId,
    name: `aitest t05 marks ${uid()}`,
    capacity: 30,
  });
  const sectionId = (sec.json as { id?: string } | undefined)?.id;
  if (sec.status !== 201 || !sectionId)
    throw new Error(`section -> ${sec.status} ${sec.text.slice(0, 200)}`);
  const [stu] = env.students(1);
  const en = await api.post(`/api/v1/timetable/sections/${sectionId}/enrollments`, {
    studentId: stu!,
  });
  if (en.status !== 201) throw new Error(`enrol -> ${en.status} ${en.text.slice(0, 200)}`);
  return { sectionId, studentId: stu! };
}
async function gradeState(env: RaceEnv, sectionId: string, studentId: string, code: string) {
  const rows = await env.q<{ id: string; numeric_score: string | null }>(
    `SELECT id::text, numeric_score::text FROM grade_entries
      WHERE tenant_id = $1 AND section_id = $2 AND student_id = $3 AND assessment_code = $4`,
    [S, sectionId, studentId, code],
  );
  const audit = rows[0]
    ? await env.q<{ from_numeric_score: string | null; to_numeric_score: string | null }>(
        `SELECT from_numeric_score::text, to_numeric_score::text FROM grade_change_audit
          WHERE tenant_id = $1 AND grade_entry_id = $2 AND action = 'grade.upsert'`,
        [S, rows[0].id],
      )
    : [];
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    rows: rows.length,
    stored: num(rows[0]?.numeric_score ?? null),
    edges: audit.map((a) => ({ from: num(a.from_numeric_score), to: num(a.to_numeric_score) })),
  };
}
/**
 * The committed writes form one chain start → ... → stored, one edge per
 * successful write and no branch (two writes from the same prior score).
 */
export function chainCheck(
  start: number | null,
  stored: number | null,
  edges: ReadonlyArray<{ from: number | null; to: number | null }>,
  successes: number,
): Check {
  const show = (v: number | null) => String(v);
  const detail = `start ${show(start)}, stored ${show(stored)}, edges ${edges.map((e) => `${show(e.from)}->${show(e.to)}`).join(' ')}, successes ${successes}`;
  if (edges.length !== successes)
    return { ok: false, detail: `${detail}: edge count != successes` };
  const froms = edges.map((e) => e.from);
  if (new Set(froms).size !== froms.length)
    return { ok: false, detail: `${detail}: lost update (branch)` };
  const next = new Map(edges.map((e) => [e.from, e.to]));
  let at = start;
  for (let i = 0; i < edges.length; i++) {
    if (!next.has(at)) return { ok: false, detail: `${detail}: chain broken at ${show(at)}` };
    at = next.get(at) ?? null;
  }
  return at === stored
    ? { ok: true, detail }
    : { ok: false, detail: `${detail}: chain ends at ${show(at)}` };
}
const scores = (n: number, base: number) => Array.from({ length: n }, (_, i) => base + i);
/**
 * Two markers with institution-wide grade-write roles (gradebook-access.ts);
 * a subject teacher would also need a staff-section assignment.
 */
let markerEnv: RaceEnv | undefined;
const marker = (i: number) =>
  markerEnv!.user(i % 2 === 0 ? 'principal' : 'admin', `marker-${i % 2}`);
export const marksVariants: Variant[] = [
  {
    id: 'gradebook-mark:create-x5',
    module: 'gradebook',
    title: 'principal and admin enter the same new mark 5x at once with different scores',
    async run(env) {
      markerEnv = env;
      const { sectionId, studentId } = await sectionWithStudent(env);
      const code = `AIT5-${uid()}`;
      const want = scores(5, 61);
      const runs = await env.fire(5, (api, i) =>
        api.as(marker(i)).put('/api/v1/gradebook/entries', {
          sectionId,
          studentId,
          assessmentCode: code,
          numericScore: want[i],
        }),
      );
      const statuses = statusesOf(runs);
      const g = await gradeState(env, sectionId, studentId, code);
      const ok = statuses.filter((s) => s === 200).length;
      return {
        statuses,
        entities: { sectionId, studentId, assessmentCode: code },
        invariant: allOf({
          'one row': expectEq(g.rows, 1),
          'no lost update': chainCheck(null, g.stored, g.edges, ok),
        }),
        status: checkStatuses(statuses, { winners: { 200: [1, 5] }, losers: [409] }),
      };
    },
  },
  {
    id: 'gradebook-mark:update-x6',
    module: 'gradebook',
    title: 'principal and admin edit one existing mark 6x at once with different scores',
    async run(env) {
      markerEnv = env;
      const { sectionId, studentId } = await sectionWithStudent(env);
      const code = `AIT5-${uid()}`;
      const first = await env.gateways[0]!.as(marker(0)).put('/api/v1/gradebook/entries', {
        sectionId,
        studentId,
        assessmentCode: code,
        numericScore: 40,
      });
      if (first.status !== 200)
        throw new Error(`initial mark -> ${first.status} ${first.text.slice(0, 200)}`);
      const want = scores(6, 71);
      const runs = await env.fire(6, (api, i) =>
        api.as(marker(i)).put('/api/v1/gradebook/entries', {
          sectionId,
          studentId,
          assessmentCode: code,
          numericScore: want[i],
        }),
      );
      const statuses = statusesOf(runs);
      const g = await gradeState(env, sectionId, studentId, code);
      const ok = statuses.filter((s) => s === 200).length;
      // The first (sequential) create is edge null -> 40.
      const edges = g.edges.filter((e) => e.from !== null);
      return {
        statuses,
        entities: { sectionId, studentId, assessmentCode: code },
        invariant: allOf({
          'one row': expectEq(g.rows, 1),
          'no lost update': chainCheck(40, g.stored, edges, ok),
        }),
        status: checkStatuses(statuses, { winners: { 200: [1, 6] }, losers: [409] }),
      };
    },
  },
  {
    id: 'exam-marks:double-entry-x5',
    module: 'examination',
    title: 'first-entry marks for one candidate and subject submitted 5x at once',
    async run(env) {
      const exam = await createExam(env);
      const [candidateId] = await registerCandidates(env, exam, 1);
      const runs = await env.fire(5, (api, i) =>
        api
          .as(env.user('examinations_officer', `clerk-${i % 2}`))
          .post(`/api/v1/examinations/${exam.id}/marks/entries`, {
            candidateId,
            subjectId: exam.subjectId,
            entryNo: 1,
            marks: 60 + i,
          }),
      );
      const statuses = statusesOf(runs);
      const [row] = await env.q<{ n: string }>(
        `SELECT count(*)::text AS n FROM exam_marks_entries
          WHERE tenant_id = $1 AND examination_id = $2 AND candidate_id = $3 AND entry_no = 1`,
        [S, exam.id, candidateId],
      );
      return {
        statuses,
        entities: { examinationId: exam.id, candidateId: candidateId! },
        invariant: expectEq(Number(row?.n), 1, 'entry-1 rows: '),
        status: checkStatuses(statuses, { winners: { 201: 1 }, losers: [409] }),
      };
    },
  },
];
