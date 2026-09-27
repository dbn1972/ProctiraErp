import { describe, expect, it } from 'vitest';

import { requesterMatchesSession } from './same-operator';

describe('requesterMatchesSession', () => {
  const user = {
    email: 'ops@proctira.test',
    sub: 'ops-e2e-user',
    displayName: 'E2E Operator',
  };

  it('matches the session email regardless of case', () => {
    expect(requesterMatchesSession('OPS@proctira.test', user)).toBe(true);
  });

  it('matches the session subject', () => {
    expect(requesterMatchesSession('ops-e2e-user', user)).toBe(true);
  });

  it('does not match a different operator', () => {
    expect(requesterMatchesSession('engineer1@proctira.org', user)).toBe(false);
  });

  it('does not match an empty requester', () => {
    expect(requesterMatchesSession('   ', user)).toBe(false);
  });
});
