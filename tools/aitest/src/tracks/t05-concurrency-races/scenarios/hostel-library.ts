/**
 * Hostel beds and library copies.
 *
 * Contracts: hostel createActiveAssignment locks the bed row and the partial
 * unique indexes uq_hostel_assignments_active_{bed,student} allow one active
 * assignment per bed and per student; losers get BedAssignmentConflictError
 * (409). Library claimCopyForCheckout locks the item row and decrements
 * `available` conditionally (PRC-M291); losers are refused (409, or 422
 * BUSINESS_RULE_ERROR, the module's sequential "no copies" refusal).
 */
import { allOf, checkStatuses, expectEq } from '../race.js';

import { S, statusesOf, uid, type RaceEnv, type Variant } from './env.js';
async function createBeds(env: RaceEnv, n: number) {
  const api = env.gateways[0]!.as(env.user('hostel_admin'));
  const must = async (path: string, body: Record<string, unknown>) => {
    const r = await api.post(path, body);
    const id = (r.json as { id?: string } | undefined)?.id;
    if (r.status !== 201 || !id) throw new Error(`${path} -> ${r.status} ${r.text.slice(0, 200)}`);
    return id;
  };
  const hostelId = await must('/api/v1/hostel', {
    name: `aitest t05 ${uid()}`,
    code: `T5${uid()}`,
  });
  const blockId = await must('/api/v1/hostel/blocks', { hostelId, name: 'Block A' });
  const roomId = await must('/api/v1/hostel/rooms', { blockId, roomNumber: '101', capacity: n });
  const beds: string[] = [];
  for (let i = 0; i < n; i++)
    beds.push(await must('/api/v1/hostel/beds', { roomId, bedLabel: `B${i + 1}` }));
  return { hostelId, roomId, beds };
}
async function activeAssignments(env: RaceEnv, where: string, params: unknown[]) {
  return env.q<{ bed_id: string; student_id: string }>(
    `SELECT bed_id::text, student_id::text FROM hostel_assignments
      WHERE tenant_id = $1 AND is_active AND ${where}`,
    [S, ...params],
  );
}
async function createItem(env: RaceEnv, copies: number) {
  const r = await env.gateways[0]!.as(env.user('librarian')).post('/api/v1/library/items', {
    title: `aitest t05 race ${uid()}`,
    copies,
  });
  const id = (r.json as { id?: string } | undefined)?.id;
  if (r.status !== 201 || !id)
    throw new Error(`library item -> ${r.status} ${r.text.slice(0, 200)}`);
  return id;
}
async function libraryState(env: RaceEnv, itemId: string) {
  const [item] = await env.q<{ available: number; copies: number }>(
    `SELECT available, copies FROM library_items WHERE tenant_id = $1 AND id = $2`,
    [S, itemId],
  );
  const loans = await env.q<{ copy_id: string | null }>(
    `SELECT copy_id::text FROM library_loans
      WHERE tenant_id = $1 AND item_id = $2 AND returned_at IS NULL`,
    [S, itemId],
  );
  const [onLoan] = await env.q<{ n: string }>(
    `SELECT count(*)::text AS n FROM library_copies
      WHERE tenant_id = $1 AND item_id = $2 AND status = 'on_loan'`,
    [S, itemId],
  );
  return {
    available: item?.available ?? -1,
    copies: item?.copies ?? -1,
    loans: loans.length,
    distinctCopies: new Set(loans.map((l) => l.copy_id)).size,
    onLoan: Number(onLoan?.n ?? 0),
  };
}
function libraryVariant(copies: number, n: number): Variant {
  return {
    id: `library-checkout:${copies}-copies-x${n}`,
    module: 'library',
    title: `${n} different students check out an item with ${copies} cop${copies === 1 ? 'y' : 'ies'} at once`,
    async run(env) {
      const itemId = await createItem(env, copies);
      const students = env.students(n);
      const runs = await env.fire(n, (api, i) =>
        api
          .as(env.user('librarian', `desk-${i % 2}`))
          .post('/api/v1/library/circulation/checkout', { itemId, studentId: students[i]! }),
      );
      const statuses = statusesOf(runs);
      const st = await libraryState(env, itemId);
      return {
        statuses,
        entities: { itemId },
        invariant: allOf({
          'open loans = copies': expectEq(st.loans, copies),
          'available = 0': expectEq(st.available, 0),
          'no copy lent twice': expectEq(st.distinctCopies, st.loans),
          'copies on loan = loans': expectEq(st.onLoan, st.loans),
        }),
        status: checkStatuses(statuses, { winners: { 201: copies }, losers: [409, 422] }),
      };
    },
  };
}
export const hostelLibraryVariants: Variant[] = [
  {
    id: 'hostel-bed:students-x8',
    module: 'hostel',
    title: '8 different students allocated to the same bed at once',
    async run(env) {
      const { beds } = await createBeds(env, 1);
      const bedId = beds[0]!;
      const students = await env.freshStudents(8);
      const runs = await env.fire(8, (api, i) =>
        api.as(env.user('hostel_admin', `warden-${i % 2}`)).post('/api/v1/hostel/assignments', {
          studentId: students[i]!,
          bedId,
          startDate: '2031-01-01',
        }),
      );
      const statuses = statusesOf(runs);
      const rows = await activeAssignments(env, 'bed_id = $2', [bedId]);
      const [bed] = await env.q<{ is_available: boolean }>(
        `SELECT is_available FROM hostel_beds WHERE tenant_id = $1 AND id = $2`,
        [S, bedId],
      );
      return {
        statuses,
        entities: { bedId },
        invariant: allOf({
          'active assignments on bed': expectEq(rows.length, 1),
          'bed marked taken': expectEq(bed?.is_available, false),
        }),
        status: checkStatuses(statuses, { winners: { 201: 1 }, losers: [409] }),
      };
    },
  },
  {
    id: 'hostel-bed:student-four-beds-x4',
    module: 'hostel',
    title: 'one student allocated to 4 different beds of a room at once',
    async run(env) {
      const { beds, roomId } = await createBeds(env, 4);
      const [stu] = await env.freshStudents(1);
      const runs = await env.fire(4, (api, i) =>
        api.as(env.user('hostel_admin')).post('/api/v1/hostel/assignments', {
          studentId: stu!,
          bedId: beds[i],
          startDate: '2031-01-01',
        }),
      );
      const statuses = statusesOf(runs);
      const rows = await activeAssignments(env, 'student_id = $2', [stu!]);
      const taken = await env.q<{ id: string }>(
        `SELECT id::text FROM hostel_beds WHERE tenant_id = $1 AND room_id = $2 AND NOT is_available`,
        [S, roomId],
      );
      return {
        statuses,
        entities: { studentId: stu!, roomId },
        invariant: allOf({
          'active assignments for student': expectEq(rows.length, 1),
          'only the assigned bed is taken': expectEq(
            taken.map((t) => t.id),
            rows.map((r) => r.bed_id),
          ),
        }),
        status: checkStatuses(statuses, { winners: { 201: 1 }, losers: [409] }),
      };
    },
  },
  {
    id: 'hostel-bed:vacate-and-allocate',
    module: 'hostel',
    title: 'vacate and allocate interleaved on one bed keep occupancy <= capacity',
    skip: 'no vacate / end-assignment route in the gateway API (only GET/POST /hostel/assignments); existing ledger row PRC-M277 (PARTIAL) tracks the missing vacate flow',
    run() {
      return Promise.reject(new Error('not runnable'));
    },
  },
  libraryVariant(1, 6),
  libraryVariant(3, 10),
];
