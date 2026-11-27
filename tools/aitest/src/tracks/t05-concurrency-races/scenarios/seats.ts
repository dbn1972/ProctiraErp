/**
 * Seat allocation: section capacity, section edits with If-Match, exam room
 * bookings, invigilator clashes and seating generation.
 *
 * Contracts: timetable enrollWithinCapacity is atomic (PRC-M403) and a stale
 * If-Match is VERSION_CONFLICT 409 (P1-TT); exam ops refuse double-booked
 * rooms and invigilators with 409 (W3-RACE-01); exam_seating is unique per
 * candidate. A request refused because the resource was taken is a conflict:
 * 409 (the brief's expectation for race losers), never 400 or 5xx.
 */
import { randomUUID } from 'node:crypto';

import { allOf, checkStatuses, expectEq } from '../race.js';

import { isoDay, okBodies, S, statusesOf, uid, type RaceEnv, type Variant } from './env.js';
async function createSection(env: RaceEnv, capacity: number) {
  const r = await env.gateways[0]!.as(env.user('timetable_officer')).post(
    '/api/v1/timetable/sections',
    {
      institutionId: env.institutionId,
      academicPeriodId: env.academicPeriodId,
      name: `aitest t05 ${uid()}`,
      capacity,
    },
  );
  const body = r.json as { id?: string; updatedAt?: string } | undefined;
  if (r.status !== 201 || !body?.id)
    throw new Error(`section create -> ${r.status} ${r.text.slice(0, 200)}`);
  return { id: body.id, updatedAt: body.updatedAt ?? '' };
}
async function enrolled(env: RaceEnv, sectionId: string) {
  const rows = await env.q<{ student_id: string }>(
    `SELECT student_id::text FROM section_enrollments
      WHERE tenant_id = $1 AND section_id = $2 AND status = 'ENROLLED'`,
    [S, sectionId],
  );
  return rows.map((r) => r.student_id);
}
export async function createExam(env: RaceEnv) {
  const r = await env.gateways[0]!.as(env.user('examinations_officer')).post(
    '/api/v1/examinations',
    {
      name: `aitest t05 race ${uid()}`,
      code: `AIT-${randomUUID().slice(0, 8).toUpperCase()}`,
      academicPeriodId: env.academicPeriodId,
      startDate: isoDay(7),
      endDate: isoDay(env.dayBase + 400),
      // A subject code no student has attempted, so the prerequisite check passes.
      subjects: [{ name: 'Race Mathematics', code: `AIT${uid().toUpperCase()}`, maxScore: 100 }],
      centers: [
        { name: 'Center A', code: 'CTR-A', institutionId: env.institutionId, capacity: 200 },
      ],
      gradingSchemes: [
        {
          name: 'Standard',
          minScore: 0,
          maxScore: 100,
          passThreshold: 40,
          thresholds: [
            { grade: 'A', minScore: 80, maxScore: 100 },
            { grade: 'F', minScore: 0, maxScore: 79 },
          ],
        },
      ],
    },
  );
  const e = r.json as
    { id?: string; subjects?: { id: string }[]; centers?: { id: string }[] } | undefined;
  if (r.status !== 201 || !e?.id)
    throw new Error(`exam create -> ${r.status} ${r.text.slice(0, 200)}`);
  return { id: e.id, subjectId: e.subjects![0]!.id, centerId: e.centers![0]!.id };
}
export async function registerCandidates(
  env: RaceEnv,
  exam: Awaited<ReturnType<typeof createExam>>,
  n: number,
) {
  const out: string[] = [];
  for (const studentId of env.examStudents(n)) {
    const r = await env.gateways[0]!.as(env.user('examinations_officer')).post(
      `/api/v1/examinations/${exam.id}/candidates`,
      { studentId, centerId: exam.centerId, subjectIds: [exam.subjectId] },
    );
    const id = (r.json as { id?: string } | undefined)?.id;
    if (r.status !== 201 || !id)
      throw new Error(`candidate -> ${r.status} ${r.text.slice(0, 200)}`);
    out.push(id);
  }
  return out;
}
const CAPACITY = 5;
export const seatVariants: Variant[] = [
  {
    id: 'section-seat:capacity-5-of-10',
    module: 'timetable',
    title: `section with capacity ${CAPACITY}: 10 different students enrol at once`,
    async run(env) {
      const section = await createSection(env, CAPACITY);
      const students = env.students(10);
      const runs = await env.fire(10, (api, i) =>
        api
          .as(env.user('timetable_officer'))
          .post(`/api/v1/timetable/sections/${section.id}/enrollments`, {
            studentId: students[i]!,
          }),
      );
      const statuses = statusesOf(runs);
      const rows = await enrolled(env, section.id);
      return {
        statuses,
        entities: { sectionId: section.id },
        invariant: allOf({
          'enrolled = capacity': expectEq(rows.length, CAPACITY),
          'no duplicate student': expectEq(new Set(rows).size, rows.length),
        }),
        status: checkStatuses(statuses, { winners: { 201: CAPACITY }, losers: [409] }),
      };
    },
  },
  {
    id: 'section-seat:same-student-x5',
    module: 'timetable',
    title: 'one student enrolled into the same section 5x at once',
    async run(env) {
      const section = await createSection(env, 30);
      const [stu] = env.students(1);
      const runs = await env.fire(5, (api) =>
        api
          .as(env.user('timetable_officer'))
          .post(`/api/v1/timetable/sections/${section.id}/enrollments`, { studentId: stu! }),
      );
      const statuses = statusesOf(runs);
      const ids = new Set(okBodies<{ id?: string }>(runs).map((b) => b?.id ?? '?'));
      return {
        statuses,
        entities: { sectionId: section.id, studentId: stu! },
        invariant: allOf({
          rows: expectEq((await enrolled(env, section.id)).length, 1),
          'one enrolment id in 2xx': { ok: ids.size <= 1, detail: [...ids].join(',') },
        }),
        status: checkStatuses(statuses, { winners: { 201: [1, 5] }, losers: [409] }),
      };
    },
  },
  {
    id: 'section-update:same-if-match-x5',
    module: 'timetable',
    title: 'two editors rename one section 5x at once with the same If-Match version',
    async run(env) {
      const section = await createSection(env, 30);
      const names = Array.from({ length: 5 }, (_, i) => `aitest t05 renamed ${i} ${uid()}`);
      const runs = await env.fire(5, (api, i) =>
        api.as(env.user('timetable_officer', `editor-${i % 2}`)).put(
          `/api/v1/timetable/sections/${section.id}`,
          { name: names[i] },
          {
            query: { institutionId: env.institutionId },
            headers: { 'if-match': `"${section.updatedAt}"` },
          },
        ),
      );
      const statuses = statusesOf(runs);
      const winners = runs.filter((r) => r.value?.status === 200).map((r) => names[r.index]);
      const [row] = await env.q<{ name: string }>(
        `SELECT name FROM sections WHERE tenant_id = $1 AND id = $2`,
        [S, section.id],
      );
      return {
        statuses,
        entities: { sectionId: section.id },
        invariant: allOf({
          'one writer won': expectEq(winners.length, 1),
          'stored name is the winner': expectEq(row?.name, winners[0]),
        }),
        status: checkStatuses(statuses, { winners: { 200: 1 }, losers: [409] }),
      };
    },
  },
  {
    id: 'exam-room:same-slot-x5',
    module: 'examination',
    title: 'the same room and time slot booked for an exam session 5x at once',
    async run(env) {
      const exam = await createExam(env);
      const body = {
        subjectId: exam.subjectId,
        date: isoDay(8),
        startTime: '09:00',
        endTime: '11:00',
        roomId: `HALL-${uid()}`,
        centerId: exam.centerId,
      };
      const runs = await env.fire(5, (api) =>
        api
          .as(env.user('examinations_officer'))
          .post(`/api/v1/examinations/${exam.id}/sessions`, body),
      );
      const statuses = statusesOf(runs);
      const [row] = await env.q<{ n: string }>(
        `SELECT count(*)::text AS n FROM exam_sessions WHERE tenant_id = $1 AND room_id = $2`,
        [S, body.roomId],
      );
      return {
        statuses,
        entities: { examinationId: exam.id, roomId: body.roomId },
        invariant: expectEq(Number(row?.n), 1, 'sessions in room: '),
        status: checkStatuses(statuses, { winners: { 201: 1 }, losers: [409] }),
      };
    },
  },
  {
    id: 'exam-invigilator:overlap-x4',
    module: 'examination',
    title: 'one invigilator allocated to two overlapping sessions at once (2 requests each)',
    async run(env, round) {
      const exam = await createExam(env);
      const sessionIds: string[] = [];
      for (const [start, end] of [
        ['09:00', '11:00'],
        ['10:00', '12:00'],
      ] as const) {
        const r = await env.gateways[0]!.as(env.user('examinations_officer')).post(
          `/api/v1/examinations/${exam.id}/sessions`,
          {
            subjectId: exam.subjectId,
            date: isoDay(env.dayBase + round),
            startTime: start,
            endTime: end,
            roomId: `HALL-${uid()}`,
            centerId: exam.centerId,
          },
        );
        const id = (r.json as { id?: string } | undefined)?.id;
        if (r.status !== 201 || !id)
          throw new Error(`session -> ${r.status} ${r.text.slice(0, 200)}`);
        sessionIds.push(id);
      }
      const staffId = env.staffIds[round % env.staffIds.length]!;
      const runs = await env.fire(4, (api, i) =>
        api
          .as(env.user('examinations_officer'))
          .post(
            `/api/v1/examinations/${exam.id}/sessions/${sessionIds[i % 2] ?? ''}/invigilators`,
            {
              staffId,
            },
          ),
      );
      const statuses = statusesOf(runs);
      const [row] = await env.q<{ n: string }>(
        `SELECT count(*)::text AS n FROM exam_invigilators
          WHERE tenant_id = $1 AND staff_id = $2 AND session_id = ANY($3::uuid[])`,
        [S, staffId, sessionIds],
      );
      return {
        statuses,
        entities: { examinationId: exam.id, staffId, sessions: sessionIds.join(',') },
        invariant: expectEq(Number(row?.n), 1, 'allocations: '),
        status: checkStatuses(statuses, { winners: { 201: 1 }, losers: [409] }),
      };
    },
  },
  {
    id: 'exam-seating:generate-x5',
    module: 'examination',
    title: 'seating plan for 4 candidates generated 5x at once',
    async run(env) {
      const exam = await createExam(env);
      const candidates = await registerCandidates(env, exam, 4);
      const runs = await env.fire(5, (api) =>
        api
          .as(env.user('examinations_officer'))
          .post(`/api/v1/examinations/${exam.id}/seating/generate`, {}),
      );
      const statuses = statusesOf(runs);
      const rows = await env.q<{ candidate_id: string; seat: string }>(
        `SELECT candidate_id::text, coalesce(room_number, '') || '/' || coalesce(seat_number, '') AS seat
           FROM exam_seating WHERE tenant_id = $1 AND examination_id = $2`,
        [S, exam.id],
      );
      return {
        statuses,
        entities: { examinationId: exam.id },
        invariant: allOf({
          'one seat per candidate': expectEq(rows.length, candidates.length),
          'no shared seat': expectEq(new Set(rows.map((r) => r.seat)).size, rows.length),
        }),
        status: checkStatuses(statuses, { winners: { 200: [1, 5] }, losers: [409] }),
      };
    },
  },
];
