/**
 * @vitest-environment jsdom
 *
 * PRC-M136: requestLeaveConfirm must never hang. When a form is dirty but no
 * leave-confirm host is mounted (the host lives inside the edit form), it fails
 * open and resolves true. When a host is ready, it dispatches the event and
 * waits for the host's Stay / Leave decision.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  LEAVE_CONFIRM_EVENT,
  clearAllInstitutionFormDirty,
  requestLeaveConfirm,
  resolveLeaveConfirm,
  writeWindowDirty,
} from './institution-unsaved-guard';

afterEach(() => {
  clearAllInstitutionFormDirty();
  document.body.innerHTML = '';
});

describe('requestLeaveConfirm hang-safety (PRC-M136)', () => {
  it('resolves true immediately when nothing is dirty', async () => {
    await expect(requestLeaveConfirm()).resolves.toBe(true);
  });

  it('resolves true when dirty but no confirm host is mounted', async () => {
    writeWindowDirty('inst-1', true);
    // No [data-ready="true"] marker in the DOM.
    await expect(requestLeaveConfirm()).resolves.toBe(true);
  });

  it('waits for the host decision when a ready host is mounted', async () => {
    writeWindowDirty('inst-1', true);
    const marker = document.createElement('span');
    marker.setAttribute('data-testid', 'institution-leave-guard-ready');
    marker.setAttribute('data-ready', 'true');
    document.body.appendChild(marker);

    let dispatched = false;
    window.addEventListener(LEAVE_CONFIRM_EVENT, () => {
      dispatched = true;
    });

    const pending = requestLeaveConfirm();
    expect(dispatched).toBe(true);
    resolveLeaveConfirm(false);
    await expect(pending).resolves.toBe(false);
  });
});
