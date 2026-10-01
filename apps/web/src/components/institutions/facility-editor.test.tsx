/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateFacilityAction, createRoomAction, refresh } = vi.hoisted(() => ({
  updateFacilityAction: vi.fn(),
  createRoomAction: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/app/(dashboard)/institutions/[id]/infrastructure/actions', () => ({
  updateFacilityAction: (...args: unknown[]) => updateFacilityAction(...args),
  createRoomAction: (...args: unknown[]) => createRoomAction(...args),
}));

import { FacilityEditor } from './facility-editor';

const nodes = [
  { id: 'land-1', name: 'North campus', capacity: 900, condition: 'Good' },
  { id: 'room-1', name: 'Lab A', capacity: 30, condition: 'Needs repair' },
];

describe('FacilityEditor (PRC-L255)', () => {
  beforeEach(() => {
    updateFacilityAction.mockReset().mockResolvedValue({ ok: true });
    createRoomAction.mockReset().mockResolvedValue({ ok: true });
    refresh.mockReset();
  });

  it('prefills the edit form from the selected facility and follows selection', () => {
    render(<FacilityEditor institutionId="i1" floors={[]} nodes={nodes} />);
    expect(screen.getByLabelText('Name', { selector: '#edit-name' })).toHaveProperty(
      'value',
      'North campus',
    );
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'room-1' } });
    expect((document.getElementById('edit-name') as HTMLInputElement).value).toBe('Lab A');
    expect((document.getElementById('edit-capacity') as HTMLInputElement).value).toBe('30');
    expect((document.getElementById('edit-condition') as HTMLSelectElement).value).toBe(
      'Needs repair',
    );
  });

  it('sends only changed fields and refreshes on success', async () => {
    render(<FacilityEditor institutionId="i1" floors={[]} nodes={nodes} />);
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'room-1' } });
    fireEvent.change(document.getElementById('edit-capacity') as HTMLInputElement, {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save facility' }));
    await waitFor(() => expect(updateFacilityAction).toHaveBeenCalledTimes(1));
    expect(updateFacilityAction).toHaveBeenCalledWith({
      institutionId: 'i1',
      id: 'room-1',
      capacity: 42,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
