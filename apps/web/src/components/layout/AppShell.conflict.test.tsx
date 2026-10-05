/**
 * PRC-M575 — the Sync_Queue conflict surface is mounted in the authenticated
 * shell: a replayed 409 (`sync:conflict`) shows the dialog, Amend leaves
 * exactly one queued op carrying the resolution token, Discard removes it.
 */
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFLICT_RESOLUTION_TOKEN_HEADER } from '@/components/sync/ConflictResolutionDialog';
import { SYNC_CONFLICT_EVENT, type SyncConflictEventDetail } from '@/lib/sync/conflict';
import { _resetForTests, enqueue, peekAll } from '@/lib/sync/syncQueue';
import enMessages from '@/messages/en.json';

vi.mock('./DesktopShell', () => ({
  DesktopShell: ({ children }: { children: React.ReactNode }) => (
    <div data-shell="desktop">{children}</div>
  ),
}));
vi.mock('./MobileShell', () => ({
  MobileShell: ({ children }: { children: React.ReactNode }) => (
    <div data-shell="mobile">{children}</div>
  ),
}));

import { AppShell } from './AppShell';

function renderShell() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AppShell>
        <p>page</p>
      </AppShell>
    </NextIntlClientProvider>,
  );
}

async function seedConflict(): Promise<SyncConflictEventDetail> {
  const queueId = await enqueue({
    tenantId: 'tenant-a',
    userId: 'user-1',
    operationType: 'PATCH',
    targetEntity: 'student',
    targetId: 's1',
    payload: {
      url: '/api/v1/students/s1',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName: 'Aisha K.' }),
    },
  });
  return {
    queueId,
    method: 'PATCH',
    url: '/api/v1/students/s1',
    targetEntity: 'student',
    targetId: 's1',
    localPayload: { studentName: 'Aisha K.' },
    conflict: {
      field_conflicts: [
        {
          field: 'studentName',
          server_value: 'Aisha Khan',
          server_version: 'v3',
          client_value: 'Aisha K.',
        },
      ],
      server_record: { id: 's1', studentName: 'Aisha Khan' },
      resolution_token: 'tok-m575',
    },
    rawResponseBody: '',
  };
}

beforeEach(async () => {
  await _resetForTests();
});
afterEach(() => {
  cleanup();
});

describe('AppShell conflict surface (PRC-M575)', () => {
  it('shows the dialog when a replayed 409 fires sync:conflict', async () => {
    renderShell();
    const detail = await seedConflict();
    act(() => {
      window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail }));
    });
    expect(await screen.findByTestId('conflict-amend')).toBeTruthy();
  });

  it('Amend leaves exactly one queued op with the merged body and resolution token', async () => {
    renderShell();
    const detail = await seedConflict();
    act(() => {
      window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId('conflict-amend'));
    });
    await waitFor(async () => {
      const ops = await peekAll();
      expect(ops).toHaveLength(1);
      expect(ops[0]!.id).not.toBe(detail.queueId);
      expect(ops[0]!.payload.headers?.[CONFLICT_RESOLUTION_TOKEN_HEADER]).toBe('tok-m575');
      expect(JSON.parse(ops[0]!.payload.body ?? '{}')).toEqual({ studentName: 'Aisha K.' });
      expect(ops[0]!.tenantId).toBe('tenant-a');
    });
  });

  it('Discard removes the queued op', async () => {
    renderShell();
    const detail = await seedConflict();
    act(() => {
      window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId('conflict-discard'));
    });
    await waitFor(async () => {
      expect(await peekAll()).toHaveLength(0);
    });
  });
});
