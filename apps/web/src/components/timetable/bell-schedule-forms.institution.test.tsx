/**
 * @vitest-environment jsdom
 *
 * PRC-M070: bell schedules require an explicit institution choice when the
 * tenant has more than one institution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const createBellScheduleAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(dashboard)/timetable-actions', () => ({
  createBellScheduleAction: (...args: unknown[]) => createBellScheduleAction(...args),
  createPeriodAction: vi.fn(),
}));

import { BellScheduleCreateForm } from './bell-schedule-forms';

describe('BellScheduleCreateForm institution picker (PRC-M070)', () => {
  beforeEach(() => {
    createBellScheduleAction.mockReset().mockResolvedValue({ ok: true });
  });

  it('requires choosing an institution and submits the chosen one', async () => {
    render(
      <BellScheduleCreateForm
        academicPeriodId="per-1"
        institutions={[
          { id: 'inst-1', name: 'North' },
          { id: 'inst-2', name: 'South' },
        ]}
      />,
    );
    const picker = screen.getByLabelText('Institution') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(picker.required).toBe(true);
    fireEvent.change(picker, { target: { value: 'inst-2' } });
    await act(async () => {
      fireEvent.submit(picker.form as HTMLFormElement);
    });
    expect(createBellScheduleAction).toHaveBeenCalledWith(
      expect.objectContaining({ institutionId: 'inst-2', academicPeriodId: 'per-1' }),
    );
  });

  it('uses the only institution without a picker', async () => {
    render(
      <BellScheduleCreateForm
        academicPeriodId="per-1"
        institutions={[{ id: 'inst-1', name: 'North' }]}
      />,
    );
    expect(screen.queryByLabelText('Institution')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    });
    expect(createBellScheduleAction).toHaveBeenCalledWith(
      expect.objectContaining({ institutionId: 'inst-1' }),
    );
  });
});
