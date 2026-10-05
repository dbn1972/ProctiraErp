/**
 * @vitest-environment jsdom
 *
 * PRC-M117 — /staff/leaves?staffId= opens the form with the staff preselected.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../../staff-leave-actions', () => ({ createStaffLeaveAction: vi.fn() }));

import { NewStaffLeaveForm } from './new-staff-leave-form';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('NewStaffLeaveForm preselect (PRC-M117)', () => {
  it('preselects defaultStaffId', () => {
    render(
      <NewStaffLeaveForm
        staffOptions={[
          { id: A, label: 'Asha Rao' },
          { id: B, label: 'Bina Shah' },
        ]}
        defaultStaffId={B}
      />,
    );
    expect((screen.getByRole('combobox', { name: 'Staff' }) as HTMLSelectElement).value).toBe(B);
  });
});
