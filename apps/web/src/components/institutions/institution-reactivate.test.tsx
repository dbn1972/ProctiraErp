/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reactivateInstitutionAction, refresh } = vi.hoisted(() => ({
  reactivateInstitutionAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/institutions/actions', () => ({
  deactivateInstitutionAction: vi.fn(),
  reactivateInstitutionAction: (...args: unknown[]) => reactivateInstitutionAction(...args),
}));

import { InstitutionReactivateButton, InstitutionRowActions } from './institution-row-actions';

function openOverflowMenu() {
  const trigger = screen.getByTestId('institution-more-school-1');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
}

describe('institution reactivate UI', () => {
  beforeEach(() => {
    if (!('ResizeObserver' in globalThis)) {
      (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        } as unknown as typeof ResizeObserver;
    }
    Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
    Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
    Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
    reactivateInstitutionAction.mockReset();
    refresh.mockReset();
    reactivateInstitutionAction.mockResolvedValue({
      success: true,
      data: { id: 'school-1', status: 'ACTIVE' },
    });
  });

  it('shows Reactivate on the overflow menu for an inactive row', () => {
    render(<InstitutionRowActions id="school-1" name="Sunrise Pre-Primary" status="INACTIVE" />);
    openOverflowMenu();
    expect(screen.getByRole('menuitem', { name: 'Reactivate' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate school' })).toBeNull();
  });

  it('keeps Reactivate off the menu for an active row', () => {
    render(<InstitutionRowActions id="school-1" name="Sunrise Pre-Primary" status="ACTIVE" />);
    openOverflowMenu();
    expect(screen.getByRole('menuitem', { name: 'Deactivate school' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Reactivate' })).toBeNull();
  });

  it('confirms a reason from the detail header and refreshes', async () => {
    const { rerender } = render(
      <InstitutionReactivateButton id="school-1" name="Sunrise Pre-Primary" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wing reopened' } });
    fireEvent.click(screen.getByTestId('reactivate-header-dialog-school-1-confirm'));

    await waitFor(() => {
      expect(reactivateInstitutionAction).toHaveBeenCalledWith('school-1', 'Wing reopened');
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(screen.getByTestId('institution-status-toast')).toHaveTextContent(/active again/i);

    rerender(
      <InstitutionReactivateButton id="school-1" name="Sunrise Pre-Primary" inactive={false} />,
    );
    expect(screen.queryByTestId('reactivate-header-school-1')).toBeNull();
    expect(screen.getByTestId('institution-status-toast')).toHaveTextContent(/active again/i);
  });
});
