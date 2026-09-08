/**
 * Property-Based Test: Notification Role-Based Targeting
 *
 * **Validates: Requirements 22.3**
 *
 * Property 31: When a notification is sent with role-based and/or area-based
 * recipient queries, the system delivers to exactly the set of users matching
 * the specified criteria. Users not matching the criteria never receive the
 * notification.
 *
 * Requirement 22.3: Deliver to all recipients matching configured role and area criteria.
 */
import { describe, it, beforeEach, expect } from 'vitest';
import fc from 'fast-check';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService } from './notification-service.js';
import type { NotificationTemplateEntity } from './notification-repository.js';

// --- Generators ---

/** Generate a valid UUID v4 string */
const arbUuid = fc.uuid().map((u) => u.toLowerCase());

/** Generate a set of unique UUIDs */
function arbUuidSet(min: number, max: number): fc.Arbitrary<string[]> {
  return fc.uniqueArray(arbUuid, { minLength: min, maxLength: max });
}

/** A user with role and area assignments */
interface TestUser {
  id: string;
  roleIds: string[];
  areaIds: string[];
  institutionIds: string[];
}

/**
 * Generate a test scenario with a pool of users, roles, and areas.
 * Some users will match the query criteria, some won't.
 */
interface TestScenario {
  allRoles: string[];
  allAreas: string[];
  users: TestUser[];
  queryRoleIds: string[];
  queryAreaIds: string[];
}

const arbTestScenario: fc.Arbitrary<TestScenario> = fc
  .record({
    allRoles: arbUuidSet(2, 5),
    allAreas: arbUuidSet(2, 5),
  })
  .chain(({ allRoles, allAreas }) => {
    // Generate users with random role/area assignments from the pool
    const arbUser = fc.record({
      id: arbUuid,
      roleIds: fc.subarray(allRoles, { minLength: 1, maxLength: allRoles.length }),
      areaIds: fc.subarray(allAreas, { minLength: 1, maxLength: allAreas.length }),
      institutionIds: fc.constant([] as string[]),
    });

    return fc.record({
      allRoles: fc.constant(allRoles),
      allAreas: fc.constant(allAreas),
      users: fc.uniqueArray(arbUser, {
        minLength: 3,
        maxLength: 10,
        selector: (u) => u.id,
      }),
      queryRoleIds: fc.subarray(allRoles, {
        minLength: 1,
        maxLength: Math.min(2, allRoles.length),
      }),
      queryAreaIds: fc.subarray(allAreas, {
        minLength: 1,
        maxLength: Math.min(2, allAreas.length),
      }),
    });
  });

// --- Helpers ---

const tenantId = '00000000-0000-4000-8000-000000000001';
const templateId = '00000000-0000-4000-8000-000000000002';

async function setupTemplate(repository: InMemoryNotificationRepository): Promise<void> {
  const template: NotificationTemplateEntity = {
    id: templateId,
    tenantId,
    name: 'Test Template',
    channel: 'in_app',
    subject: null,
    body: 'Test notification for {{name}}',
    variables: ['name'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await repository.createTemplate(template);
}

/**
 * Compute expected recipients for role-only query.
 * All users who have at least one of the queried roles.
 */
function expectedRecipientsForRoles(users: TestUser[], roleIds: string[]): Set<string> {
  const result = new Set<string>();
  for (const user of users) {
    if (user.roleIds.some((r) => roleIds.includes(r))) {
      result.add(user.id);
    }
  }
  return result;
}

/**
 * Compute expected recipients for area-only query.
 * All users who are in at least one of the queried areas.
 */
function expectedRecipientsForAreas(users: TestUser[], areaIds: string[]): Set<string> {
  const result = new Set<string>();
  for (const user of users) {
    if (user.areaIds.some((a) => areaIds.includes(a))) {
      result.add(user.id);
    }
  }
  return result;
}

/**
 * Compute expected recipients when both role and area are specified.
 * The current implementation uses union (OR) logic — users matching roles OR areas.
 */
function expectedRecipientsForRolesAndAreas(
  users: TestUser[],
  roleIds: string[],
  areaIds: string[],
): Set<string> {
  const result = new Set<string>();
  for (const user of users) {
    const matchesRole = user.roleIds.some((r) => roleIds.includes(r));
    const matchesArea = user.areaIds.some((a) => areaIds.includes(a));
    if (matchesRole || matchesArea) {
      result.add(user.id);
    }
  }
  return result;
}

// --- Property Tests ---

describe('Property 31: Notification Role-Based Targeting', () => {
  let repository: InMemoryNotificationRepository;
  let service: NotificationService;

  beforeEach(() => {
    repository = new InMemoryNotificationRepository();
    service = new NotificationService(repository);
  });

  it('should deliver to ALL users matching the specified role criteria', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        repository.clear();
        await setupTemplate(repository);
        repository.seedUsers(scenario.users);

        const expected = expectedRecipientsForRoles(scenario.users, scenario.queryRoleIds);

        // Skip if no recipients would match (service throws BusinessRuleError)
        if (expected.size === 0) return;

        const notifications = await service.send(tenantId, {
          channel: 'in_app',
          templateId,
          recipients: { roleIds: scenario.queryRoleIds },
          variables: { name: 'Test' },
        });

        const actualRecipients = new Set(notifications.map((n) => n.recipientUserId));

        // All expected recipients must receive the notification
        for (const expectedId of expected) {
          if (!actualRecipients.has(expectedId)) {
            throw new Error(
              `User ${expectedId} matches role criteria but did NOT receive notification. ` +
                `Query roles: [${scenario.queryRoleIds.join(', ')}]`,
            );
          }
        }

        // No unexpected recipients
        for (const actualId of actualRecipients) {
          if (!expected.has(actualId)) {
            throw new Error(
              `User ${actualId} does NOT match role criteria but received notification. ` +
                `Query roles: [${scenario.queryRoleIds.join(', ')}]`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should deliver to ALL users matching the specified area criteria', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        repository.clear();
        await setupTemplate(repository);
        repository.seedUsers(scenario.users);

        const expected = expectedRecipientsForAreas(scenario.users, scenario.queryAreaIds);

        // Skip if no recipients would match
        if (expected.size === 0) return;

        const notifications = await service.send(tenantId, {
          channel: 'in_app',
          templateId,
          recipients: { areaIds: scenario.queryAreaIds },
          variables: { name: 'Test' },
        });

        const actualRecipients = new Set(notifications.map((n) => n.recipientUserId));

        // All expected recipients must receive the notification
        for (const expectedId of expected) {
          if (!actualRecipients.has(expectedId)) {
            throw new Error(
              `User ${expectedId} matches area criteria but did NOT receive notification. ` +
                `Query areas: [${scenario.queryAreaIds.join(', ')}]`,
            );
          }
        }

        // No unexpected recipients
        for (const actualId of actualRecipients) {
          if (!expected.has(actualId)) {
            throw new Error(
              `User ${actualId} does NOT match area criteria but received notification. ` +
                `Query areas: [${scenario.queryAreaIds.join(', ')}]`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should deliver to users matching role OR area when both criteria are specified', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        repository.clear();
        await setupTemplate(repository);
        repository.seedUsers(scenario.users);

        const expected = expectedRecipientsForRolesAndAreas(
          scenario.users,
          scenario.queryRoleIds,
          scenario.queryAreaIds,
        );

        // Skip if no recipients would match
        if (expected.size === 0) return;

        const notifications = await service.send(tenantId, {
          channel: 'in_app',
          templateId,
          recipients: { roleIds: scenario.queryRoleIds, areaIds: scenario.queryAreaIds },
          variables: { name: 'Test' },
        });

        const actualRecipients = new Set(notifications.map((n) => n.recipientUserId));

        // All expected recipients must receive the notification
        for (const expectedId of expected) {
          if (!actualRecipients.has(expectedId)) {
            throw new Error(
              `User ${expectedId} matches role OR area criteria but did NOT receive notification. ` +
                `Query roles: [${scenario.queryRoleIds.join(', ')}], areas: [${scenario.queryAreaIds.join(', ')}]`,
            );
          }
        }

        // No unexpected recipients (users not matching either criterion)
        for (const actualId of actualRecipients) {
          if (!expected.has(actualId)) {
            throw new Error(
              `User ${actualId} does NOT match role OR area criteria but received notification. ` +
                `Query roles: [${scenario.queryRoleIds.join(', ')}], areas: [${scenario.queryAreaIds.join(', ')}]`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should NEVER deliver to users not matching any specified criteria', async () => {
    await fc.assert(
      fc.asyncProperty(arbTestScenario, async (scenario) => {
        repository.clear();
        await setupTemplate(repository);
        repository.seedUsers(scenario.users);

        // Send with role-only query
        const expectedRole = expectedRecipientsForRoles(scenario.users, scenario.queryRoleIds);
        if (expectedRole.size === 0) return;

        const notifications = await service.send(tenantId, {
          channel: 'in_app',
          templateId,
          recipients: { roleIds: scenario.queryRoleIds },
          variables: { name: 'Test' },
        });

        const actualRecipients = new Set(notifications.map((n) => n.recipientUserId));

        // Identify users who should NOT have received the notification
        const nonMatchingUsers = scenario.users.filter(
          (u) => !u.roleIds.some((r) => scenario.queryRoleIds.includes(r)),
        );

        for (const user of nonMatchingUsers) {
          if (actualRecipients.has(user.id)) {
            throw new Error(
              `User ${user.id} does NOT match role criteria [${scenario.queryRoleIds.join(', ')}] ` +
                `(user roles: [${user.roleIds.join(', ')}]) but received notification`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
