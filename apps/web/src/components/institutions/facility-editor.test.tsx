/**
 * @vitest-environment jsdom
 *
 * PRC-L255 — the edit-facility form prefills from, and follows, the selected
 * facility and sends only the fields the user changed, so saving never
 * overwrites untouched name/capacity/condition values with blanks or defaults.
 * A successful save refreshes the route so the hierarchy reflects it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const updateFacilityAction = vi.hoisted(() => vi.fn());
const createRoomAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/app/(dashboard)/institutions/[id]/infrastructure/actions', () => ({
  updateFacilityAction,
  createRoomAction,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { FacilityEditor } from './facility-editor';

const INST = '55555555-5555-4555-8555-555555555555';
const NODE_A = '77777777-7777-4777-8777-777777777777';
const NODE_B = '88888888-8888-4888-8888-888888888888';
const NODE_C = '99999999-9999-4999-8999-999999999999';

const NODES = [
  { id: NODE_A, name: 'Main campus', capacity: 500, condition: 'Good' },
  { id: NODE_B, name: 'Lab B', capacity: 40, condition: 'Fair' },
  { id: NODE_C, name: 'Old store', capacity: 10, condition: 'POOR' },
];

function renderEditor() {
  const view = render(<FacilityEditor institutionId={INST} floors={[]} nodes={NODES} />);
  const q = <T extends Element>(sel: string) => view.container.querySelector(sel) as T;
  return {
    ...view,
    select: () => q<HTMLSelectElement>('#edit-facility'),
    name: () => q<HTMLInputElement>('#edit-name'),
    capacity: () => q<HTMLInputElement>('#edit-capacity'),
    condition: () => q<HTMLSelectElement>('#edit-condition'),
    form: () => screen.getByTestId('edit-facility-form') as HTMLFormElement,
  };
}

beforeEach(() => {
  updateFacilityAction.mockReset();
  updateFacilityAction.mockResolvedValue({ ok: true });
  createRoomAction.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('FacilityEditor edit form (PRC-L255)', () => {
  it('prefills the fields from the first facility', () => {
    const ui = renderEditor();
    expect(ui.name().value).toBe('Main campus');
    expect(ui.capacity().value).toBe('500');
    expect(ui.condition().value).toBe('Good');
  });

  it('follows the selected facility', () => {
    const ui = renderEditor();
    act(() => {
      fireEvent.change(ui.select(), { target: { value: NODE_B } });
    });
    expect(ui.name().value).toBe('Lab B');
    expect(ui.capacity().value).toBe('40');
    expect(ui.condition().value).toBe('Fair');
  });

  it('sends only the changed field and refreshes after a successful save', async () => {
    const ui = renderEditor();
    act(() => {
      fireEvent.change(ui.select(), { target: { value: NODE_B } });
    });
    fireEvent.change(ui.capacity(), { target: { value: '45' } });
    fireEvent.submit(ui.form());

    await waitFor(() => expect(updateFacilityAction).toHaveBeenCalledTimes(1));
    expect(updateFacilityAction).toHaveBeenCalledWith({
      institutionId: INST,
      id: NODE_B,
      capacity: 45,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toBe('Facility updated.');
  });

  it('does not rewrite an unmapped legacy condition the user left alone', async () => {
    const ui = renderEditor();
    act(() => {
      fireEvent.change(ui.select(), { target: { value: NODE_C } });
    });
    fireEvent.change(ui.name(), { target: { value: 'Old store room' } });
    fireEvent.submit(ui.form());

    await waitFor(() => expect(updateFacilityAction).toHaveBeenCalledTimes(1));
    expect(updateFacilityAction).toHaveBeenCalledWith({
      institutionId: INST,
      id: NODE_C,
      name: 'Old store room',
    });
  });

  it('skips the save when nothing changed', async () => {
    const ui = renderEditor();
    fireEvent.submit(ui.form());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No changes to save.'));
    expect(updateFacilityAction).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
