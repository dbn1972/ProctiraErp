/**
 * Live Postgres proof for PgParentPortalRepository (G-732): guardian links,
 * fee plans and invoices persist through `withPgTenant`, invoice status
 * updates are tenant-bound, and a second tenant sees nothing under FORCE RLS.
 * Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import {
  getSharedParentPortalPool,
  PgParentPortalRepository,
} from './pg-parent-portal-repository.js';

const pool = getSharedParentPortalPool();

async function seedTenant(tenantId: string): Promise<void> {
  await withPgTenant(pool!, tenantId, (client) =>
    client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `parent-portal-test-${tenantId.slice(0, 8)}`, `parent-portal-test-${tenantId}`],
    ),
  );
}

describe('PgParentPortalRepository (live)', () => {
  it.skipIf(!pool)('persists guardian links and enforces the per-tenant unique pair', async () => {
    const repo = new PgParentPortalRepository(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await Promise.all([seedTenant(tenantA), seedTenant(tenantB)]);
    const parentUserId = randomUUID();
    const studentId = randomUUID();

    const link = await repo.createChildLink({
      id: randomUUID(),
      tenantId: tenantA,
      parentUserId,
      studentId,
      relationship: 'mother',
      status: 'active',
    });
    expect(link.relationship).toBe('mother');

    expect(await repo.hasActiveLink(tenantA, parentUserId, studentId)).toBe(true);
    expect((await repo.listChildLinksForParent(tenantA, parentUserId)).map((l) => l.id)).toEqual([
      link.id,
    ]);
    expect((await repo.findChildLink(link.id, tenantA))?.studentId).toBe(studentId);

    // Same ids under another tenant: invisible, and insertable independently.
    expect(await repo.hasActiveLink(tenantB, parentUserId, studentId)).toBe(false);
    expect(await repo.findChildLink(link.id, tenantB)).toBeNull();
    expect(await repo.listChildLinksForStudent(tenantB, studentId)).toEqual([]);

    await expect(
      repo.createChildLink({
        id: randomUUID(),
        tenantId: tenantA,
        parentUserId,
        studentId,
        relationship: 'father',
        status: 'pending',
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it.skipIf(!pool)('persists fee plans and invoices; status updates stay tenant-bound', async () => {
    const repo = new PgParentPortalRepository(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await Promise.all([seedTenant(tenantA), seedTenant(tenantB)]);
    const studentId = randomUUID();

    const plan = await repo.createFeePlan({
      id: randomUUID(),
      tenantId: tenantA,
      code: 'TERM-1',
      name: 'Term 1 tuition',
      description: 'Tuition for term 1',
      amountCents: 150_000,
      currency: 'INR',
      frequency: 'term',
      status: 'active',
      createdBy: 'finance-1',
    });
    expect((await repo.findFeePlanById(plan.id, tenantA))?.amountCents).toBe(150_000);
    expect((await repo.listFeePlans(tenantA)).map((p) => p.id)).toEqual([plan.id]);
    expect(await repo.listFeePlans(tenantB)).toEqual([]);

    const invoice = await repo.createInvoice({
      id: randomUUID(),
      tenantId: tenantA,
      studentId,
      planId: plan.id,
      title: 'Term 1 tuition',
      description: '',
      amountCents: 150_000,
      currency: 'INR',
      status: 'open',
      dueAt: new Date('2026-10-01T00:00:00Z'),
      createdBy: 'finance-1',
    });
    expect(invoice.planId).toBe(plan.id);
    expect((await repo.listInvoicesForStudentIds(tenantA, [studentId])).map((i) => i.id)).toEqual([
      invoice.id,
    ]);

    // Tenant B cannot read or flip the invoice.
    expect(await repo.findInvoiceById(invoice.id, tenantB)).toBeNull();
    expect(await repo.updateInvoice(invoice.id, tenantB, { status: 'paid' })).toBeNull();
    expect((await repo.findInvoiceById(invoice.id, tenantA))?.status).toBe('open');

    const paid = await repo.updateInvoice(invoice.id, tenantA, { status: 'paid' });
    expect(paid?.status).toBe('paid');
    expect(paid?.updatedAt.getTime()).toBeGreaterThanOrEqual(invoice.updatedAt.getTime());
  });
});
