/**
 * @vitest-environment jsdom
 *
 * PRC-H026 / PRC-H032 — sign-out and a user/tenant switch wipe the offline
 * Sync_Queue (IndexedDB) and autosaved drafts (localStorage), not just the
 * service-worker caches, so a shared device never shows or replays the
 * previous user's data.
 */
import 'fake-indexeddb/auto';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTests, enqueue, peekAll } from '@/lib/sync/syncQueue';
import { buildDraftKey } from '@/lib/draft/useDraftAutosave';
import { AuthProvider, type AuthUser } from '@/providers/AuthProvider';
import { noteSignedInIdentity, purgeOnSignOut, sessionIdentityKey } from './offline-purge';

function user(id: string, tenant = 't1'): AuthUser {
  return {
    id,
    email: `${id}@school.test`,
    name: id,
    roles: ['teacher'],
    permissions: [],
    scope: { level: 'school' },
    tenant_id: tenant,
  };
}

async function seedUserData(): Promise<string> {
  await enqueue({
    tenantId: 't1',
    userId: 'A',
    operationType: 'POST',
    targetEntity: 'attendance',
    payload: { url: '/api/v1/attendance', body: '{"present":true}' },
  });
  const draftKey = buildDraftKey('student-form');
  window.localStorage.setItem(draftKey, JSON.stringify({ values: { name: 'A child' } }));
  window.localStorage.setItem('unrelated-pref', 'keep');
  return draftKey;
}

beforeEach(async () => {
  await _resetForTests();
  window.localStorage.clear();
  vi.stubGlobal('caches', { keys: vi.fn(async () => []), delete: vi.fn(async () => true) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('purgeOnSignOut / noteSignedInIdentity', () => {
  it('sign-out removes queued operations, drafts and the remembered identity', async () => {
    const draftKey = await seedUserData();
    window.localStorage.setItem(sessionIdentityKey(), 't1:A');
    await purgeOnSignOut();
    expect(await peekAll()).toEqual([]);
    expect(window.localStorage.getItem(draftKey)).toBeNull();
    expect(window.localStorage.getItem(sessionIdentityKey())).toBeNull();
    expect(window.localStorage.getItem('unrelated-pref')).toBe('keep');
  });

  it('keeps the same user’s queue across re-authentication, purges on a different user', async () => {
    const draftKey = await seedUserData();
    expect(await noteSignedInIdentity('t1:A')).toBe(false);
    expect(await noteSignedInIdentity('t1:A')).toBe(false);
    expect(await peekAll()).toHaveLength(1);

    expect(await noteSignedInIdentity('t1:B')).toBe(true);
    expect(await peekAll()).toEqual([]);
    expect(window.localStorage.getItem(draftKey)).toBeNull();
    expect(window.localStorage.getItem(sessionIdentityKey())).toBe('t1:B');
  });

  it('treats a tenant change for the same user id as a switch', async () => {
    await seedUserData();
    await noteSignedInIdentity('t1:A');
    expect(await noteSignedInIdentity('t2:A')).toBe(true);
    expect(await peekAll()).toEqual([]);
  });
});

describe('wiring', () => {
  it('signOut() wipes the sync queue and drafts before redirecting', async () => {
    const draftKey = await seedUserData();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const { signOut } = await import('@/lib/auth/session');
    await signOut('#logged-out');
    expect(await peekAll()).toEqual([]);
    expect(window.localStorage.getItem(draftKey)).toBeNull();
  });

  it('AuthProvider purges the previous user’s data when user B signs in after user A', async () => {
    window.localStorage.setItem(sessionIdentityKey(), 't1:A');
    const draftKey = await seedUserData();
    render(
      <AuthProvider initialUser={user('B')} hydrate={false}>
        <span />
      </AuthProvider>,
    );
    await waitFor(async () => expect(await peekAll()).toEqual([]));
    expect(window.localStorage.getItem(draftKey)).toBeNull();
    expect(window.localStorage.getItem(sessionIdentityKey())).toBe('t1:B');
  });

  it('AuthProvider leaves the same user’s queued writes alone', async () => {
    window.localStorage.setItem(sessionIdentityKey(), 't1:A');
    await seedUserData();
    render(
      <AuthProvider initialUser={user('A')} hydrate={false}>
        <span />
      </AuthProvider>,
    );
    await waitFor(() => expect(window.localStorage.getItem(sessionIdentityKey())).toBe('t1:A'));
    expect(await peekAll()).toHaveLength(1);
  });
});
