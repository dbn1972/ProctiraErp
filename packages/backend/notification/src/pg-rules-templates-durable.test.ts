/**
 * PRC-H071: notification rules, templates and recipient directory must be
 * durable (shared across instances), not per-process memory. These tests use a
 * shared store behind a pg-shaped mock pool, so two HybridNotificationRepository
 * instances (restart / second replica) see the same data. They would fail
 * against the old in-memory delegation.
 */
import { describe, it, expect, vi } from 'vitest';

import { HybridNotificationRepository } from './pg-notification-repository.js';
import type {
  NotificationRuleEntity,
  NotificationTemplateEntity,
} from './notification-repository.js';

type Row = Record<string, unknown>;

function createSharedPool() {
  const templates: Row[] = [];
  const rules: Row[] = [];
  const directory: Row[] = [];

  function arrayOverlap(a: unknown, b: unknown): boolean {
    const bs = (b as string[]) ?? [];
    const as = (a as string[]) ?? [];
    return bs.length > 0 && as.some((x) => bs.includes(x));
  }

  function run(text: string, values: unknown[] = []): { rows: Row[]; rowCount: number } {
    const sql = text.trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('set_config')) return { rows: [], rowCount: 0 };
    // Schema readiness probe: echo requested relations + migrations as present.
    if (sql.includes('requirement_exists') || sql.includes('requirement_type')) {
      const [relations, migrations] = values as [string[], string[]];
      const rows: Row[] = [];
      for (const r of relations ?? []) {
        rows.push({ requirement_type: 'relation', requirement_name: r, requirement_exists: true });
      }
      for (const m of migrations ?? []) {
        rows.push({ requirement_type: 'migration', requirement_name: m, requirement_exists: true });
      }
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO notification_templates')) {
      const [id, tenant_id, name, channel, subject, body, variables] = values;
      const row: Row = {
        id,
        tenant_id,
        name,
        channel,
        subject,
        body,
        variables,
        created_at: new Date(),
        updated_at: new Date(),
      };
      templates.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM notification_templates') && sql.includes('WHERE id = $1')) {
      const [id, tenant_id] = values;
      const f = templates.find((r) => r['id'] === id && r['tenant_id'] === tenant_id);
      return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
    }
    if (sql.includes('FROM notification_templates') && sql.includes('WHERE tenant_id = $1')) {
      const [tenant_id] = values;
      return {
        rows: templates.filter((r) => r['tenant_id'] === tenant_id),
        rowCount: 0,
      };
    }

    if (sql.startsWith('INSERT INTO notification_rules')) {
      const [
        id,
        tenant_id,
        name,
        entity_type,
        event,
        conditions,
        template_id,
        channels,
        recipient_query,
        is_active,
        schedule,
      ] = values;
      const row: Row = {
        id,
        tenant_id,
        name,
        entity_type,
        event,
        conditions,
        template_id,
        channels,
        recipient_query,
        is_active,
        schedule,
        created_at: new Date(),
        updated_at: new Date(),
      };
      rules.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM notification_rules') && sql.includes('event = $3')) {
      const [tenant_id, entity_type, event] = values;
      return {
        rows: rules.filter(
          (r) =>
            r['tenant_id'] === tenant_id &&
            r['entity_type'] === entity_type &&
            r['event'] === event &&
            r['is_active'] === true,
        ),
        rowCount: 0,
      };
    }
    if (sql.includes('FROM notification_rules') && sql.includes('WHERE tenant_id = $1')) {
      const [tenant_id] = values;
      return { rows: rules.filter((r) => r['tenant_id'] === tenant_id), rowCount: 0 };
    }

    if (sql.startsWith('INSERT INTO notification_directory_users')) {
      const [tenant_id, user_id, role_ids, area_ids, institution_ids] = values;
      const existing = directory.find(
        (r) => r['tenant_id'] === tenant_id && r['user_id'] === user_id,
      );
      if (existing) {
        existing['role_ids'] = role_ids;
        existing['area_ids'] = area_ids;
        existing['institution_ids'] = institution_ids;
      } else {
        directory.push({ tenant_id, user_id, role_ids, area_ids, institution_ids });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM notification_directory_users')) {
      const [tenant_id, roleIds, areaIds, institutionIds] = values;
      const matched = directory.filter(
        (r) =>
          r['tenant_id'] === tenant_id &&
          (arrayOverlap(r['role_ids'], roleIds) ||
            arrayOverlap(r['area_ids'], areaIds) ||
            arrayOverlap(r['institution_ids'], institutionIds)),
      );
      return { rows: matched.map((r) => ({ user_id: r['user_id'] })), rowCount: matched.length };
    }

    throw new Error(`unexpected SQL: ${sql}`);
  }

  const client = {
    query: vi.fn((text: string, values?: unknown[]) => Promise.resolve(run(text, values))),
    release: () => {},
  };
  return {
    connect: () => Promise.resolve(client),
    query: (text: string, values?: unknown[]) => Promise.resolve(run(text, values)),
  };
}

const TENANT = '00000000-0000-4000-8000-00000000ab01';

function sampleTemplate(): NotificationTemplateEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: TENANT,
    name: 'Absence Alert',
    channel: 'email',
    subject: 'Absence',
    body: 'Dear {{name}}',
    variables: ['name'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function sampleRule(): NotificationRuleEntity {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: TENANT,
    name: 'Absence rule',
    entityType: 'attendance',
    event: 'created',
    conditions: { status: 'absent' },
    templateId: sampleTemplate().id,
    channels: ['email'],
    recipientQuery: { roleIds: ['role-parent'] },
    isActive: true,
    schedule: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Durable notification rules/templates/recipients (PRC-H071)', () => {
  it('template persists and survives a "restart" (new repo instance)', async () => {
    const pool = createSharedPool();
    const repo1 = new HybridNotificationRepository(pool as never);
    await repo1.createTemplate(sampleTemplate());

    const repo2 = new HybridNotificationRepository(pool as never);
    const found = await repo2.getTemplateById(TENANT, sampleTemplate().id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Absence Alert');
    expect(found?.variables).toEqual(['name']);
  });

  it('rule persists and is returned by getActiveRulesForEvent across instances', async () => {
    const pool = createSharedPool();
    const repo1 = new HybridNotificationRepository(pool as never);
    await repo1.createRule(sampleRule());

    const repo2 = new HybridNotificationRepository(pool as never);
    const active = await repo2.getActiveRulesForEvent(TENANT, 'attendance', 'created');
    expect(active).toHaveLength(1);
    expect(active[0]?.recipientQuery).toEqual({ roleIds: ['role-parent'] });
  });

  it('resolveRecipients reads the durable directory (role broadcast finds members)', async () => {
    const pool = createSharedPool();
    const repo = new HybridNotificationRepository(pool as never);
    await repo.upsertDirectoryUsers(TENANT, [
      { id: 'u-parent-1', roleIds: ['role-parent'], areaIds: [], institutionIds: [] },
      { id: 'u-teacher-1', roleIds: ['role-teacher'], areaIds: [], institutionIds: [] },
    ]);

    const recipients = await repo.resolveRecipients(TENANT, { roleIds: ['role-parent'] });
    expect(recipients).toEqual(['u-parent-1']);
  });

  it('resolveRecipients returns nothing for a role with no durable members', async () => {
    const pool = createSharedPool();
    const repo = new HybridNotificationRepository(pool as never);
    const recipients = await repo.resolveRecipients(TENANT, { roleIds: ['role-nobody'] });
    expect(recipients).toEqual([]);
  });
});
