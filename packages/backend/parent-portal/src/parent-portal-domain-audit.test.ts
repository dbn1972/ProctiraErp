/**
 * PRC-M533 — same-transaction domain audit events for the 4 mutation families the finding
 * names (consent decide/withdraw/supersede, link creation, invoice void, payment recording).
 * A fake pg pool (`connect()` returns a single recording client per `withPgTenant` call)
 * proves: (a) `appendAuditEntryOnClient`'s `audit_log_entries` INSERT runs on the SAME client
 * instance as the domain write for each of the 6 call sites, and (b) no audit wiring reaches
 * household/custody provisioning (FEAT-003's scope, explicitly out of this finding).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PgParentPortalRepository } from './pg-parent-portal-repository.js';
import { ParentPortalService, type ParentPortalAuditActor } from './parent-portal-service.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const PARENT_USER = '00000000-0000-4000-8000-000000000021';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000101';

const ACTOR: ParentPortalAuditActor = {
  userId: 'staff-1',
  userName: 'Staff One',
  ipAddress: '127.0.0.1',
};

type QueryCall = { sql: string; values: unknown[]; client: unknown };

/**
 * Fake connectable pg pool: every `withPgTenant` call checks out ONE client (recorded on
 * `connects`) that answers BEGIN/set_config/COMMIT with empty rows, synthesizes a RETURNING row
 * for every domain INSERT/UPDATE this suite issues, and otherwise returns rows matching what
 * `appendAuditEntryOnClient` (audit_chain_heads / audit_log_entries) expects. Every query made
 * on that client is pushed to the shared `calls` log tagged with the client instance, so a test
 * can assert the domain write and the audit INSERT share the identical client object.
 */
function createFakePool() {
  const calls: QueryCall[] = [];
  const connects: unknown[] = [];
  const consentsById = new Map<string, Record<string, unknown>>();
  const now = new Date();

  const pool = {
    connect: vi.fn(async () => {
      const client = {
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
          calls.push({ sql, values, client });

          if (/^(BEGIN|COMMIT|ROLLBACK)\b/.test(sql.trim())) {
            return { rows: [] };
          }
          if (/^SELECT set_config/.test(sql.trim())) {
            return { rows: [] };
          }
          // audit_chain_heads upsert / lock read (txn-mutation-audit.ts).
          if (/INSERT INTO audit_chain_heads/.test(sql)) {
            return { rows: [] };
          }
          if (/SELECT head_seq, head_hash FROM audit_chain_heads/.test(sql)) {
            return { rows: [{ head_seq: 0, head_hash: null }] };
          }
          if (/UPDATE audit_chain_heads/.test(sql)) {
            return { rows: [] };
          }
          if (/INSERT INTO audit_log_entries/.test(sql)) {
            return { rows: [{ ...rowStubFor('audit_log_entries', values) }] };
          }
          // UPDATE ... parent_consents ... valid_to ... RETURNING id  (close step)
          if (/UPDATE parent_consents/.test(sql) && /RETURNING id/.test(sql)) {
            return { rows: [{ id: values[1] }] };
          }
          // SELECT * FROM parent_consents WHERE id = $1 AND tenant_id = $2  (findConsentById)
          if (/SELECT \* FROM parent_consents WHERE id/.test(sql)) {
            const stored = consentsById.get(String(values[0]));
            return { rows: stored ? [stored] : [] };
          }
          // INSERT INTO parent_consents (...) RETURNING *  (create / successor insert)
          if (/INSERT INTO parent_consents/.test(sql)) {
            const row = rowStubFor('parent_consents', values);
            consentsById.set(String(row.id), row);
            return { rows: [row] };
          }
          // INSERT INTO parent_child_links (...) RETURNING *
          if (/INSERT INTO parent_child_links/.test(sql)) {
            return { rows: [rowStubFor('parent_child_links', values)] };
          }
          // UPDATE parent_fee_invoices ... RETURNING *  (void)
          if (/UPDATE parent_fee_invoices/.test(sql)) {
            return { rows: [rowStubFor('parent_fee_invoices', values)] };
          }
          // INSERT INTO parent_fee_payments (...) RETURNING *
          if (/INSERT INTO parent_fee_payments/.test(sql)) {
            return { rows: [rowStubFor('parent_fee_payments', values)] };
          }
          // INSERT INTO guardian_households / guardian_household_members /
          // guardian_student_custody / guardian_custody_restrictions (...) RETURNING *
          // (FEAT-003 scope — must stay audit-free; see the scope-check test below).
          if (/INSERT INTO guardian_households/.test(sql)) {
            return {
              rows: [
                {
                  id: values[0],
                  tenant_id: values[1],
                  label: values[2],
                  status: values[3],
                  created_at: now,
                  updated_at: now,
                },
              ],
            };
          }
          if (/INSERT INTO guardian_household_members/.test(sql)) {
            return {
              rows: [
                {
                  id: values[0],
                  tenant_id: values[1],
                  household_id: values[2],
                  parent_user_id: values[3],
                  role: values[4],
                  status: values[5],
                  created_at: now,
                  updated_at: now,
                },
              ],
            };
          }
          if (/INSERT INTO guardian_student_custody/.test(sql)) {
            return {
              rows: [
                {
                  id: values[0],
                  tenant_id: values[1],
                  student_id: values[2],
                  household_id: values[3],
                  custody_type: values[4],
                  status: values[5],
                  effective_from: values[6],
                  effective_to: null,
                  created_at: now,
                  updated_at: now,
                },
              ],
            };
          }
          if (/INSERT INTO guardian_custody_restrictions/.test(sql)) {
            return {
              rows: [
                {
                  id: values[0],
                  tenant_id: values[1],
                  student_id: values[2],
                  parent_user_id: values[3],
                  household_id: values[4],
                  restriction_kind: values[5],
                  blocks_medical: values[6],
                  blocks_fees: values[7],
                  blocks_all_access: values[8],
                  status: values[9],
                  effective_from: values[10],
                  effective_to: values[11],
                  court_order_ref: values[12],
                  notes: values[13],
                  created_at: now,
                  updated_at: now,
                },
              ],
            };
          }
          // Readiness probe / anything else this suite does not seed explicitly.
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      connects.push(client);
      return client;
    }),
    query: vi.fn(async () => ({ rows: [] })),
  };

  return { pool, calls, connects };
}

/** Builds a plausible RETURNING row for the given table from the positional INSERT values. */
function rowStubFor(table: string, values: unknown[]): Record<string, unknown> {
  const now = new Date();
  switch (table) {
    case 'audit_log_entries':
      return {
        id: values[0],
        tenant_id: values[1],
        entity_type: values[2],
        entity_id: values[3],
        operation: values[4],
        user_id: values[5],
        user_name: values[6],
        ip_address: values[7],
        occurred_at: values[8],
        before_values: null,
        after_values: null,
        metadata: null,
        chain_seq: 1,
        prev_hash: null,
        entry_hash: 'deadbeef',
      };
    case 'parent_consents':
      return {
        id: values[0],
        tenant_id: values[1],
        student_id: values[2],
        parent_user_id: values[3],
        consent_type: values[4],
        title: values[5],
        description: values[6],
        status: values[7],
        consent_version: values[8],
        consent_chain_id: values[9],
        version: values[10],
        supersedes_id: values[11],
        valid_from: values[12],
        valid_to: null,
        decided_at: values[13],
        created_by: values[14],
        withdrawal_reason: values[15],
        decided_via: values[16],
        created_at: now,
        updated_at: now,
      };
    case 'parent_child_links':
      return {
        id: values[0],
        tenant_id: values[1],
        parent_user_id: values[2],
        student_id: values[3],
        relationship: values[4],
        status: values[5],
        is_primary: values[6],
        can_consent_medical: values[7],
        can_view_fees: values[8],
        household_id: values[9],
        created_at: now,
        updated_at: now,
      };
    case 'parent_fee_invoices':
      // UPDATE ... SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3
      return {
        id: values[1],
        tenant_id: values[2],
        student_id: STUDENT_ID,
        plan_id: null,
        title: 'Term fee',
        description: '',
        amount_cents: 5000,
        currency: 'INR',
        status: values[0],
        due_at: null,
        created_by: 'staff',
        created_at: now,
        updated_at: now,
      };
    case 'parent_fee_payments':
      return {
        id: values[0],
        invoice_id: values[1],
        tenant_id: values[2],
        payer_user_id: values[3],
        amount_cents: values[4],
        method: values[5],
        status: values[6],
        paid_at: values[7],
        created_at: now,
      };
    default:
      return {};
  }
}

function auditInsertCalls(calls: QueryCall[]): QueryCall[] {
  return calls.filter((c) => /INSERT INTO audit_log_entries/.test(c.sql));
}

function stubEnsureSchema(repo: PgParentPortalRepository): void {
  (repo as unknown as { ensureSchema: () => Promise<void> }).ensureSchema = async () => {};
}

/**
 * The consent decide/withdraw/supersede flows assert the parent is actively linked to the
 * student before mutating (assertParentLinkedToStudent / assertConsentTargetLinked) — stub
 * that lookup so this suite's fake pool only needs to model the consent/audit write path.
 */
function stubActiveLink(repo: PgParentPortalRepository): void {
  const repoAny = repo as unknown as Record<string, unknown>;
  repoAny.findActiveLink = async (tenantId: string, parentUserId: string, studentId: string) => ({
    id: 'link-1',
    tenantId,
    parentUserId,
    studentId,
    relationship: 'guardian',
    status: 'active',
    isPrimary: true,
    canConsentMedical: true,
    canViewFees: true,
    householdId: HOUSEHOLD_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // assertParentLinkedToStudent also requires an effective household/custody overlap
  // (W1-SEC-03) — stub those lookups so this suite's fake pool only needs to model the
  // consent/audit write path, not the full custody graph.
  repoAny.listActiveCustodyHouseholdIdsForStudent = async () => [HOUSEHOLD_ID];
  repoAny.listActiveHouseholdIdsForParent = async () => [HOUSEHOLD_ID];
  repoAny.listActiveCustodyRestrictions = async () => [];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PRC-M533 same-transaction domain audit (mocked pg client)', () => {
  it('consent decide: audit_log_entries INSERT runs on the same client as the consent write', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);
    stubActiveLink(repo);
    const service = new ParentPortalService(repo);

    const consent = await repo.createConsent({
      id: 'consent-1',
      tenantId: TENANT,
      studentId: STUDENT_ID,
      parentUserId: PARENT_USER,
      consentType: 'photo_media',
      title: 'Photo consent',
      description: '',
      status: 'pending',
      consentVersion: 'v1',
      consentChainId: 'consent-1',
      version: 1,
      supersedesId: null,
      validFrom: new Date(),
      createdBy: 'staff',
      withdrawalReason: null,
      decidedVia: null,
    });
    calls.length = 0; // only inspect the decide call's own transaction below.

    await service.decideConsent(TENANT, PARENT_USER, consent.id, { status: 'approved' }, ACTOR);

    const consentInsert = calls.find(
      (c) => /INSERT INTO parent_consents/.test(c.sql) && !/audit/.test(c.sql),
    );
    const auditInserts = auditInsertCalls(calls);
    expect(consentInsert).toBeDefined();
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.client).toBe(consentInsert!.client);
  });

  it('consent withdraw: audit row shares the withdraw transaction client', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);
    stubActiveLink(repo);
    const service = new ParentPortalService(repo);

    const consent = await repo.createConsent({
      id: 'consent-2',
      tenantId: TENANT,
      studentId: STUDENT_ID,
      parentUserId: PARENT_USER,
      consentType: 'data_sharing',
      title: 'Data sharing',
      description: '',
      status: 'pending',
      consentVersion: 'v1',
      consentChainId: 'consent-2',
      version: 1,
      supersedesId: null,
      validFrom: new Date(),
      createdBy: 'staff',
      withdrawalReason: null,
      decidedVia: null,
    });
    const approved = await service.decideConsent(TENANT, PARENT_USER, consent.id, {
      status: 'approved',
    });
    calls.length = 0;

    await service.withdrawConsent(
      TENANT,
      PARENT_USER,
      approved.id,
      { reason: 'parent request' },
      ACTOR,
    );

    const consentInsert = calls.find(
      (c) => /INSERT INTO parent_consents/.test(c.sql) && !/audit/.test(c.sql),
    );
    const auditInserts = auditInsertCalls(calls);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.client).toBe(consentInsert!.client);
  });

  it('consent supersede: audit row shares the supersede transaction client', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);
    stubActiveLink(repo);
    const service = new ParentPortalService(repo);

    const consent = await repo.createConsent({
      id: 'consent-3',
      tenantId: TENANT,
      studentId: STUDENT_ID,
      parentUserId: PARENT_USER,
      consentType: 'field_trip',
      title: 'Trip 2025',
      description: '',
      status: 'pending',
      consentVersion: 'trip-2025',
      consentChainId: 'consent-3',
      version: 1,
      supersedesId: null,
      validFrom: new Date(),
      createdBy: 'staff',
      withdrawalReason: null,
      decidedVia: null,
    });
    const approved = await service.decideConsent(TENANT, PARENT_USER, consent.id, {
      status: 'approved',
    });
    calls.length = 0;

    await service.supersedeConsent(
      TENANT,
      'staff',
      approved.id,
      { consentVersion: 'trip-2026' },
      ACTOR,
    );

    const consentInsert = calls.find(
      (c) => /INSERT INTO parent_consents/.test(c.sql) && !/audit/.test(c.sql),
    );
    const auditInserts = auditInsertCalls(calls);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.client).toBe(consentInsert!.client);
  });

  it('link create: audit row shares the parent_child_links insert transaction client', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);
    const service = new ParentPortalService(repo);

    await service.linkChild(
      TENANT,
      PARENT_USER,
      { studentId: STUDENT_ID, householdId: HOUSEHOLD_ID },
      { isStaff: true, auditActor: ACTOR },
    );

    const linkInsert = calls.find(
      (c) => /INSERT INTO parent_child_links/.test(c.sql) && !/audit/.test(c.sql),
    );
    const auditInserts = auditInsertCalls(calls);
    expect(linkInsert).toBeDefined();
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.client).toBe(linkInsert!.client);
  });

  it('invoice void (non-fees-ledger fallback): audit row shares the void transaction client', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);
    (
      repo as unknown as { findInvoiceById: (id: string, tenantId: string) => Promise<unknown> }
    ).findInvoiceById = async (id: string, tenantId: string) => ({
      id,
      tenantId,
      studentId: STUDENT_ID,
      planId: null,
      title: 'Term fee',
      description: '',
      amountCents: 5000,
      currency: 'INR',
      status: 'open',
      dueAt: null,
      createdBy: 'staff',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new ParentPortalService(repo);

    await service.voidInvoice(TENANT, 'invoice-1', { actorId: 'staff-1', auditActor: ACTOR });

    const invoiceUpdate = calls.find(
      (c) => /UPDATE parent_fee_invoices/.test(c.sql) && !/audit/.test(c.sql),
    );
    const auditInserts = auditInsertCalls(calls);
    expect(invoiceUpdate).toBeDefined();
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.client).toBe(invoiceUpdate!.client);
  });

  it('payment record (non-fees-ledger fallback): audit row shares the createPayment transaction client', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);

    await repo.createPayment(
      {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        tenantId: TENANT,
        payerUserId: PARENT_USER,
        amountCents: 5000,
        method: 'sandbox',
        status: 'succeeded',
        paidAt: new Date(),
      },
      () => ({
        entityType: 'parent-portal',
        entityId: 'payment-1',
        operation: 'CREATE',
        userId: ACTOR.userId,
        userName: ACTOR.userName,
        ipAddress: ACTOR.ipAddress,
      }),
    );

    const paymentInsert = calls.find(
      (c) => /INSERT INTO parent_fee_payments/.test(c.sql) && !/audit/.test(c.sql),
    );
    const auditInserts = auditInsertCalls(calls);
    expect(paymentInsert).toBeDefined();
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.client).toBe(paymentInsert!.client);
  });

  it('scope check: no audit wiring reaches household/custody provisioning (FEAT-003 scope)', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);
    const service = new ParentPortalService(repo);

    await service.createHousehold(TENANT, { id: HOUSEHOLD_ID, label: 'Household A' });
    await service.addHouseholdMember(TENANT, {
      householdId: HOUSEHOLD_ID,
      parentUserId: PARENT_USER,
      role: 'primary',
    });
    await service.assignStudentCustody(TENANT, {
      studentId: STUDENT_ID,
      householdId: HOUSEHOLD_ID,
    });
    await service.createCustodyRestriction(TENANT, {
      studentId: STUDENT_ID,
      parentUserId: PARENT_USER,
    });

    expect(auditInsertCalls(calls)).toHaveLength(0);
  });

  it('omitting auditActor on linkChild appends no audit row (audit is proof, not a precondition)', async () => {
    const { pool, calls } = createFakePool();
    const repo = new PgParentPortalRepository(pool as never);
    stubEnsureSchema(repo);
    const service = new ParentPortalService(repo);

    const link = await service.linkChild(
      TENANT,
      PARENT_USER,
      { studentId: STUDENT_ID, householdId: HOUSEHOLD_ID },
      { isStaff: true },
    );

    expect(link.id).toBeTruthy();
    expect(auditInsertCalls(calls)).toHaveLength(0);
  });
});
