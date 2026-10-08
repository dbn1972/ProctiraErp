/**
 * g7_platform-004 — sensitive notification variables are redacted on persist/return but the real
 * values still reach the recipient on the delivery attempt.
 *
 * These tests FAIL without the fix: before, send() persisted input.variables verbatim, so the
 * inbox/status APIs returned reset links / OTPs / tokens in plaintext.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService, type EmailSender } from './notification-service.js';
import {
  REDACTED_MARKER,
  isSensitiveVariableName,
  redactSensitiveVariables,
} from './sensitive-variables.js';

const TENANT_ID = 'tenant-sensitive';

describe('g7_platform-004 classifier', () => {
  it.each([
    'otp',
    'resetLink',
    'reset_link',
    'passwordResetToken',
    'verificationCode',
    'apiKey',
    'mfaCode',
    'bearerToken',
  ])('treats %s as sensitive by default', (name) => {
    expect(isSensitiveVariableName(name)).toBe(true);
  });

  it.each(['name', 'school', 'dueDate', 'amount'])('treats %s as non-sensitive', (name) => {
    expect(isSensitiveVariableName(name)).toBe(false);
  });

  it('honours an explicit sensitive allowlist', () => {
    expect(isSensitiveVariableName('inviteUrl', { sensitiveVariables: ['inviteUrl'] })).toBe(true);
  });

  it('honours an explicit public opt-out even against the denylist', () => {
    expect(isSensitiveVariableName('resetName', { publicVariables: ['resetName'] })).toBe(false);
  });

  it('redacts only sensitive values', () => {
    const out = redactSensitiveVariables({
      name: 'Ada',
      resetLink: 'https://x/abc',
      otp: '123456',
    });
    expect(out).toEqual({ name: 'Ada', resetLink: REDACTED_MARKER, otp: REDACTED_MARKER });
  });
});

describe('g7_platform-004 send() persists redacted but delivers real values', () => {
  it('stores redacted variables yet the email sender receives the real reset link', async () => {
    const repository = new InMemoryNotificationRepository();
    repository.seedUsers([
      { id: 'user-1', roleIds: ['teacher'], areaIds: ['a1'], institutionIds: ['i1'] },
    ]);
    const template = await repository.createTemplate({
      id: 'tpl-reset',
      tenantId: TENANT_ID,
      name: 'Reset',
      channel: 'email',
      subject: 'Reset for {{name}}',
      body: 'Click {{resetLink}} (code {{otp}})',
      variables: ['name', 'resetLink', 'otp'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let deliveredBody = '';
    const email: EmailSender = {
      async send(params) {
        deliveredBody = params.body;
        return { success: true };
      },
    };
    const service = new NotificationService(repository, email);

    const [created] = await service.send(TENANT_ID, {
      templateId: template.id,
      channel: 'email',
      recipients: { userIds: ['user-1'] },
      variables: { name: 'Ada', resetLink: 'https://app/reset/REALTOKEN', otp: '987654' },
    });

    // The outbound email carried the REAL values.
    expect(deliveredBody).toContain('https://app/reset/REALTOKEN');
    expect(deliveredBody).toContain('987654');

    // The persisted record (what inbox/status APIs return) is redacted.
    const stored = await repository.getNotificationById(TENANT_ID, created.id);
    expect(stored?.variables['name']).toBe('Ada');
    expect(stored?.variables['resetLink']).toBe(REDACTED_MARKER);
    expect(stored?.variables['otp']).toBe(REDACTED_MARKER);
    expect(JSON.stringify(stored?.variables)).not.toContain('REALTOKEN');
    expect(JSON.stringify(stored?.variables)).not.toContain('987654');
  });
});
