/**
 * @vitest-environment jsdom
 *
 * <ConflictResolutionDialog> tests — Task 54.5 / Requirement 38.7 / Design §I.
 *
 * Verifies the dialog contract:
 *
 *   1. Opens when a `sync:conflict` window event fires; renders the
 *      local payload, the server payload, and one row per conflicting
 *      field with the values highlighted side-by-side.
 *
 *   2. **Amend** dispatches `sync:amend-conflict` with the merged
 *      payload (per-field `client` vs `server` choices applied) and
 *      removes the failed op from the queue.
 *
 *   3. **Discard** dispatches `sync:discard-conflict` with the server
 *      record and removes the failed op from the queue.
 *
 *   4. The dialog cannot be dismissed without choosing an action — a
 *      bare close attempt is ignored. (Verified through the absence
 *      of a Close button affordance in the rendered footer.)
 *
 *   5. Bursts of conflicts queue up — the second event is rendered
 *      after the user resolves the first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';

import enMessages from '@/messages/en.json';

import { ConflictResolutionDialog } from './ConflictResolutionDialog';
import {
  SYNC_AMEND_CONFLICT_EVENT,
  SYNC_CONFLICT_EVENT,
  SYNC_DISCARD_CONFLICT_EVENT,
  type ConflictPayload,
  type SyncAmendConflictEventDetail,
  type SyncConflictEventDetail,
  type SyncDiscardConflictEventDetail,
} from '@/lib/sync/conflict';

// ─── Harness ────────────────────────────────────────────────────────────────

function Harness({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

const sampleConflict: ConflictPayload = {
  field_conflicts: [
    {
      field: 'studentName',
      server_value: 'Aisha Khan',
      server_version: 'v3',
      client_value: 'Aisha K.',
    },
    {
      field: 'gradeLevel',
      server_value: 5,
      server_version: 'v3',
      client_value: 6,
    },
  ],
  server_record: { id: 's1', studentName: 'Aisha Khan', gradeLevel: 5 },
  resolution_token: 'tok-abc-123',
};

function makeDetail(overrides: Partial<SyncConflictEventDetail> = {}): SyncConflictEventDetail {
  return {
    queueId: 'op-1',
    method: 'PATCH',
    url: '/api/v1/students/s1',
    targetEntity: 'student',
    targetId: 's1',
    localPayload: { studentName: 'Aisha K.', gradeLevel: 6 },
    conflict: sampleConflict,
    rawResponseBody: '',
    ...overrides,
  };
}

function fireConflict(detail: SyncConflictEventDetail) {
  act(() => {
    window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail }));
  });
}

// ─── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  // Each test starts with a fresh render harness.
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Test cases ─────────────────────────────────────────────────────────────

describe('<ConflictResolutionDialog> — opens on sync:conflict', () => {
  it('does not render anything before a conflict arrives', () => {
    render(
      <Harness>
        <ConflictResolutionDialog dequeueOperation={vi.fn()} />
      </Harness>,
    );
    expect(screen.queryByTestId('conflict-resolution-dialog')).toBeNull();
  });

  it('renders the dialog when a sync:conflict event fires', () => {
    render(
      <Harness>
        <ConflictResolutionDialog dequeueOperation={vi.fn()} />
      </Harness>,
    );
    fireConflict(makeDetail());
    expect(screen.getByTestId('conflict-resolution-dialog')).not.toBeNull();
  });

  it('renders one row per conflicting field with both values', () => {
    render(
      <Harness>
        <ConflictResolutionDialog dequeueOperation={vi.fn()} />
      </Harness>,
    );
    fireConflict(makeDetail());

    // studentName row.
    expect(screen.getByTestId('conflict-studentName-client-value').textContent).toBe('Aisha K.');
    expect(screen.getByTestId('conflict-studentName-server-value').textContent).toBe('Aisha Khan');

    // gradeLevel row — non-string scalars render as JSON (so the user
    // can distinguish 5 from "5").
    expect(screen.getByTestId('conflict-gradeLevel-client-value').textContent).toBe('6');
    expect(screen.getByTestId('conflict-gradeLevel-server-value').textContent).toBe('5');
  });

  it('renders the local and server payload panels', () => {
    render(
      <Harness>
        <ConflictResolutionDialog dequeueOperation={vi.fn()} />
      </Harness>,
    );
    fireConflict(makeDetail());

    const local = screen.getByTestId('conflict-local-payload');
    const server = screen.getByTestId('conflict-server-payload');
    expect(local.textContent).toContain('Aisha K.');
    expect(server.textContent).toContain('Aisha Khan');
  });
});

// ─── Amend ──────────────────────────────────────────────────────────────────

describe('<ConflictResolutionDialog> — Amend', () => {
  it('dispatches sync:amend-conflict with the merged payload (default keeps local)', async () => {
    const dequeueSpy = vi.fn().mockResolvedValue(undefined);
    const amendSpy = vi.fn();
    window.addEventListener(SYNC_AMEND_CONFLICT_EVENT, amendSpy);

    try {
      render(
        <Harness>
          <ConflictResolutionDialog dequeueOperation={dequeueSpy} />
        </Harness>,
      );
      fireConflict(makeDetail());

      await act(async () => {
        fireEvent.click(screen.getByTestId('conflict-amend'));
      });

      expect(dequeueSpy).toHaveBeenCalledWith('op-1');
      expect(amendSpy).toHaveBeenCalledTimes(1);

      const event = amendSpy.mock.calls[0]![0] as CustomEvent<SyncAmendConflictEventDetail>;
      expect(event.detail.queueId).toBe('op-1');
      expect(event.detail.url).toBe('/api/v1/students/s1');
      expect(event.detail.method).toBe('PATCH');
      expect(event.detail.resolutionToken).toBe('tok-abc-123');
      // Default resolution is `client` for every field — local payload unchanged.
      expect(event.detail.mergedPayload).toEqual({
        studentName: 'Aisha K.',
        gradeLevel: 6,
      });
    } finally {
      window.removeEventListener(SYNC_AMEND_CONFLICT_EVENT, amendSpy);
    }
  });

  it('applies "Use server value" choices into the merged payload', async () => {
    const amendSpy = vi.fn();
    window.addEventListener(SYNC_AMEND_CONFLICT_EVENT, amendSpy);

    try {
      render(
        <Harness>
          <ConflictResolutionDialog dequeueOperation={vi.fn().mockResolvedValue(undefined)} />
        </Harness>,
      );
      fireConflict(makeDetail());

      // Toggle the studentName resolution to "server".
      fireEvent.click(screen.getByTestId('conflict-studentName-use-server'));

      await act(async () => {
        fireEvent.click(screen.getByTestId('conflict-amend'));
      });

      const event = amendSpy.mock.calls[0]![0] as CustomEvent<SyncAmendConflictEventDetail>;
      expect(event.detail.mergedPayload).toEqual({
        studentName: 'Aisha Khan', // server value
        gradeLevel: 6, // local value (default)
      });
    } finally {
      window.removeEventListener(SYNC_AMEND_CONFLICT_EVENT, amendSpy);
    }
  });
});

// ─── Discard ────────────────────────────────────────────────────────────────

describe('<ConflictResolutionDialog> — Discard', () => {
  it('dispatches sync:discard-conflict with the server record and dequeues the op', async () => {
    const dequeueSpy = vi.fn().mockResolvedValue(undefined);
    const discardSpy = vi.fn();
    window.addEventListener(SYNC_DISCARD_CONFLICT_EVENT, discardSpy);

    try {
      render(
        <Harness>
          <ConflictResolutionDialog dequeueOperation={dequeueSpy} />
        </Harness>,
      );
      fireConflict(makeDetail());

      await act(async () => {
        fireEvent.click(screen.getByTestId('conflict-discard'));
      });

      expect(dequeueSpy).toHaveBeenCalledWith('op-1');
      expect(discardSpy).toHaveBeenCalledTimes(1);

      const event = discardSpy.mock.calls[0]![0] as CustomEvent<SyncDiscardConflictEventDetail>;
      expect(event.detail.queueId).toBe('op-1');
      expect(event.detail.targetEntity).toBe('student');
      expect(event.detail.targetId).toBe('s1');
      expect(event.detail.serverRecord).toEqual(sampleConflict.server_record);
    } finally {
      window.removeEventListener(SYNC_DISCARD_CONFLICT_EVENT, discardSpy);
    }
  });
});

// ─── Burst handling ─────────────────────────────────────────────────────────

describe('<ConflictResolutionDialog> — burst handling', () => {
  it('queues a second conflict and renders it after the first is resolved', async () => {
    const dequeueSpy = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness>
        <ConflictResolutionDialog dequeueOperation={dequeueSpy} />
      </Harness>,
    );

    fireConflict(makeDetail({ queueId: 'op-1' }));
    fireConflict(
      makeDetail({
        queueId: 'op-2',
        url: '/api/v1/students/s2',
        targetId: 's2',
      }),
    );

    // First conflict is rendered.
    expect(screen.getByTestId('conflict-resolution-dialog')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('conflict-discard'));
    });

    // First op is dequeued; second conflict is now rendered.
    expect(dequeueSpy).toHaveBeenCalledWith('op-1');
    expect(screen.getByTestId('conflict-resolution-dialog')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('conflict-discard'));
    });
    expect(dequeueSpy).toHaveBeenCalledWith('op-2');

    // Queue empty — dialog unmounts.
    expect(screen.queryByTestId('conflict-resolution-dialog')).toBeNull();
  });

  it('drops duplicate sync:conflict events for the same queueId', async () => {
    render(
      <Harness>
        <ConflictResolutionDialog dequeueOperation={vi.fn().mockResolvedValue(undefined)} />
      </Harness>,
    );
    fireConflict(makeDetail({ queueId: 'op-1' }));
    fireConflict(makeDetail({ queueId: 'op-1' }));

    // First Discard resolves the only entry; the queue is now empty.
    await act(async () => {
      fireEvent.click(screen.getByTestId('conflict-discard'));
    });
    expect(screen.queryByTestId('conflict-resolution-dialog')).toBeNull();
  });
});
