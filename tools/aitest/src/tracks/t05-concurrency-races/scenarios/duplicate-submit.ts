/**
 * Duplicate submits (double-click, retry storm, two tabs).
 *
 * Contracts: the gateway Idempotency-Key plugin (shared Redis, both gateways)
 * runs a keyed POST once, answers 409 while it is in flight and replays the
 * cached response after (plugins/idempotency.ts); the public registration
 * submit dedupes on (tenant, submission_key) (db unique index + ON CONFLICT);
 * circular send claims the draft with a compare-and-set (PRC-M502), so a
 * circular is delivered once; generated admission numbers stay unique under
 * parallel student creates (students_tenant_admission_number_uidx).
 */
import type { ApiResponse } from '../../../foundation/index.js';
import { TENANTS } from '../../../foundation/index.js';
import { hostRequest } from '../host-request.js';
import { allOf, checkStatuses, expectEq, race, spread } from '../race.js';

import { okBodies, S, statusesOf, uid, type Variant } from './env.js';
const idsOf = (runs: Parameters<typeof okBodies>[0]) =>
  new Set(okBodies<{ id?: string }>(runs).map((b) => b?.id ?? '?'));
function studentBody(lastName: string) {
  return { firstName: 'Aitest', lastName, dateOfBirth: '2016-02-29', gender: 'female' };
}
export const duplicateVariants: Variant[] = [
  {
    id: 'dup-submit:student-header-key-x10',
    module: 'student',
    title: 'the same student admission form posted 10x with one Idempotency-Key',
    async run(env, round) {
      const lastName = `T5Key${round}${uid()}`;
      const key = `aitest-t05-student-${uid()}`;
      const runs = await env.fire(10, (api) =>
        api
          .as(env.user('admin', 'desk-a'))
          .post('/api/v1/students', studentBody(lastName), { headers: { 'idempotency-key': key } }),
      );
      const statuses = statusesOf(runs);
      const [row] = await env.q<{ n: string }>(
        `SELECT count(*)::text AS n FROM students WHERE tenant_id = $1 AND last_name = $2`,
        [S, lastName],
      );
      const ids = idsOf(runs);
      return {
        statuses,
        entities: { lastName, key },
        invariant: allOf({
          rows: expectEq(Number(row?.n), 1),
          'one id in 2xx': { ok: ids.size === 1, detail: [...ids].join(',') },
        }),
        status: checkStatuses(statuses, { winners: { 201: [1, 10] }, losers: [409] }),
      };
    },
  },
  {
    id: 'dup-submit:student-distinct-x10',
    module: 'student',
    title: '10 different students created at once get 10 distinct admission numbers',
    async run(env, round) {
      const prefix = `T5Adm${round}${uid()}`;
      const runs = await env.fire(10, (api, i) =>
        api
          .as(env.user(i % 2 === 0 ? 'admin' : 'principal', 'desk'))
          .post('/api/v1/students', studentBody(`${prefix}-${i}`)),
      );
      const statuses = statusesOf(runs);
      const rows = await env.q<{ admission_number: string | null }>(
        `SELECT admission_number FROM students WHERE tenant_id = $1 AND last_name LIKE $2`,
        [S, `${prefix}-%`],
      );
      const numbers = rows.map((r) => r.admission_number ?? '');
      return {
        statuses,
        entities: { lastNamePrefix: prefix },
        invariant: allOf({
          rows: expectEq(rows.length, 10),
          'distinct admission numbers': expectEq(new Set(numbers.filter(Boolean)).size, 10),
        }),
        status: checkStatuses(statuses, { winners: { 201: 10 }, losers: [] }),
      };
    },
  },
  {
    id: 'dup-submit:invoice-header-key-x10',
    module: 'fees',
    title: 'the same fee invoice posted 10x with one Idempotency-Key',
    async run(env, round) {
      const [stu] = env.students(1);
      const title = `aitest t05 dup ${round} ${uid()}`;
      const key = `aitest-t05-invoice-${uid()}`;
      const runs = await env.fire(10, (api) =>
        api
          .as(env.user('bursar'))
          .post(
            '/api/v1/fees/invoices',
            { studentId: stu!, title, amountCents: 5_000 },
            { headers: { 'idempotency-key': key } },
          ),
      );
      const statuses = statusesOf(runs);
      const [row] = await env.q<{ n: string }>(
        `SELECT count(*)::text AS n FROM parent_fee_invoices WHERE tenant_id = $1 AND title = $2`,
        [S, title],
      );
      const ids = idsOf(runs);
      return {
        statuses,
        entities: { title, key },
        invariant: allOf({
          rows: expectEq(Number(row?.n), 1),
          'one id in 2xx': { ok: ids.size === 1, detail: [...ids].join(',') },
        }),
        status: checkStatuses(statuses, { winners: { 201: [1, 10] }, losers: [409] }),
      };
    },
  },
  {
    id: 'dup-submit:circular-header-key-x10',
    module: 'communication',
    title: 'the same circular draft posted 10x with one Idempotency-Key',
    async run(env, round) {
      const title = `aitest t05 circular ${round} ${uid()}`;
      const key = `aitest-t05-circular-${uid()}`;
      const runs = await env.fire(10, (api) =>
        api
          .as(env.user('communications_officer'))
          .post(
            '/api/v1/communication/circulars',
            { title, body: 'Race test circular (synthetic).', audienceType: 'all' },
            { headers: { 'idempotency-key': key } },
          ),
      );
      const statuses = statusesOf(runs);
      const [row] = await env.q<{ n: string }>(
        `SELECT count(*)::text AS n FROM comms_circulars WHERE tenant_id = $1 AND title = $2`,
        [S, title],
      );
      const ids = idsOf(runs);
      return {
        statuses,
        entities: { title, key },
        invariant: allOf({
          rows: expectEq(Number(row?.n), 1),
          'one id in 2xx': { ok: ids.size === 1, detail: [...ids].join(',') },
        }),
        status: checkStatuses(statuses, { winners: { 201: [1, 10] }, losers: [409] }),
      };
    },
  },
  {
    id: 'circular-send:x5',
    module: 'communication',
    title: 'one circular sent 5x at once is delivered once',
    async run(env, round) {
      const officer = env.user('communications_officer');
      const created = await env.gateways[0]!.as(officer).post('/api/v1/communication/circulars', {
        title: `aitest t05 send ${round} ${uid()}`,
        body: 'Race test circular (synthetic).',
        audienceType: 'all',
      });
      const circularId = (created.json as { id?: string } | undefined)?.id;
      if (created.status !== 201 || !circularId) throw new Error(`circular -> ${created.status}`);
      const runs = await env.fire(5, (api) =>
        api.as(officer).post(`/api/v1/communication/circulars/${circularId}/send`, {}),
      );
      const statuses = statusesOf(runs);
      const [c] = await env.q<{ status: string; channels: string[] }>(
        `SELECT status, channels FROM comms_circulars WHERE tenant_id = $1 AND id = $2`,
        [S, circularId],
      );
      const [d] = await env.q<{ n: string; keys: string }>(
        `SELECT count(*)::text AS n, count(DISTINCT (channel, recipient_id))::text AS keys
           FROM comms_delivery_log WHERE tenant_id = $1 AND source_type = 'circular' AND source_id = $2`,
        [S, circularId],
      );
      return {
        statuses,
        entities: { circularId },
        invariant: allOf({
          sent: expectEq(c?.status, 'sent'),
          'one delivery per channel and recipient': expectEq(Number(d?.n), Number(d?.keys)),
          'delivered at all': { ok: Number(d?.n) > 0, detail: `${d?.n ?? '0'} deliveries` },
        }),
        status: checkStatuses(statuses, { winners: { 200: 1 }, losers: [409] }),
      };
    },
  },
  {
    id: 'dup-submit:registration-key-x5',
    module: 'registration',
    title: 'the public admission application submitted 5x with one Idempotency-Key (both gateways)',
    async run(env, round) {
      const [form] = await env.q<{ id: string; institution_id: string; version: number }>(
        `SELECT id::text, institution_id::text, version FROM admission_form_configurations
          WHERE tenant_id = $1 AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
        [TENANTS.REG.id],
      );
      if (!form) throw new Error('no published REG admission form');
      const lastName = `T5Reg${round}${uid()}`;
      const key = `aitest-t05-reg-${uid()}`;
      const body = {
        institutionId: form.institution_id,
        formConfigurationId: form.id,
        formConfigurationVersion: form.version,
        firstName: 'Aitest',
        lastName,
        dateOfBirth: '2019-06-15',
        gender: 'male',
        guardianName: 'Aitest Guardian',
        guardianPhone: '+910000000000',
      };
      const urls = env.ctx.state.urls.gateways;
      const runs = await race(5, (i): Promise<ApiResponse> => {
        const base = spread(urls, i);
        const port = new URL(base).port;
        return hostRequest(
          base,
          `${TENANTS.REG.slug}.proctira.localhost:${port}`,
          'POST',
          '/api/v1/registrations',
          {
            body,
            headers: { 'idempotency-key': key },
          },
        );
      });
      const statuses = statusesOf(runs);
      const [row] = await env.q<{ n: string }>(
        `SELECT count(*)::text AS n FROM admission_applications WHERE tenant_id = $1 AND last_name = $2`,
        [TENANTS.REG.id, lastName],
      );
      const tracking = new Set(
        okBodies<{ trackingNumber?: string }>(runs).map((b) => b?.trackingNumber ?? '?'),
      );
      return {
        statuses,
        entities: { lastName, key },
        invariant: allOf({
          rows: expectEq(Number(row?.n), 1),
          'one tracking number in 2xx': {
            ok: tracking.size === 1,
            detail: [...tracking].join(','),
          },
        }),
        status: checkStatuses(statuses, { winners: { 201: 1, 200: [0, 4] }, losers: [409] }),
      };
    },
  },
];
