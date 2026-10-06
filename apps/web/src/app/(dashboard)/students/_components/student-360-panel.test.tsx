/** PRC-M124 — consent save failures surface + revert; incident removal needs confirmation. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  setStudentConsentAction: vi.fn(),
  removeStudentDisciplineAction: vi.fn(),
  addStudentDisciplineAction: vi.fn(),
  addStudentSiblingAction: vi.fn(),
  uploadStudentPhotoAction: vi.fn(),
}));
const refresh = vi.fn();
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/providers/AuthProvider', () => ({
  useOptionalAuth: () => ({ user: { id: 'me-0000-0000-0000-00000000aaaa' } }),
}));

import { Student360Panel, consentActorLabel } from './student-360-panel';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const INCIDENT = '22222222-2222-4222-8222-222222222222';

function renderPanel() {
  return render(
    <Student360Panel
      studentId={STUDENT}
      hasPhoto={false}
      siblings={[]}
      consents={[
        {
          id: 'c1',
          studentId: STUDENT,
          kind: 'photo',
          granted: false,
          actorId: '33333333-3333-4333-8333-333333abcdef',
          recordedAt: '2026-04-01T10:00:00.000Z',
        },
      ]}
      incidents={[
        {
          id: INCIDENT,
          studentId: STUDENT,
          incidentType: 'Late',
          severity: 'low',
          description: 'Late to class',
          actionTaken: null,
          reporterId: 'r1',
          incidentDate: '2026-04-02',
          visibleToParent: true,
          createdAt: '2026-04-02T00:00:00.000Z',
        },
      ]}
    />,
  );
}

describe('Student 360 panel (PRC-M124)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels the actor instead of printing a raw UUID', () => {
    renderPanel();
    expect(screen.getByText(/by staff user …abcdef/)).toBeTruthy();
    expect(screen.queryByText(/33333333-3333/)).toBeNull();
    expect(consentActorLabel('me', 'me')).toBe('you');
  });

  it('shows an alert and reverts the switch when the consent save fails', async () => {
    actions.setStudentConsentAction.mockResolvedValue({ status: 'error', message: 'Forbidden' });
    renderPanel();
    const toggle = screen.getByTestId('consent-toggle-photo');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not saved/));
    expect(screen.getByTestId('consent-toggle-photo').getAttribute('aria-checked')).toBe('false');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('removing an incident requires confirmation', async () => {
    actions.removeStudentDisciplineAction.mockResolvedValue({ status: 'success' });
    renderPanel();
    fireEvent.click(screen.getByTestId('discipline-remove'));
    expect(actions.removeStudentDisciplineAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('discipline-remove-confirm').textContent).toMatch(/parents can/);
    await act(async () => {
      fireEvent.click(screen.getByTestId('discipline-remove-confirm-confirm'));
    });
    await waitFor(() =>
      expect(actions.removeStudentDisciplineAction).toHaveBeenCalledWith(STUDENT, INCIDENT),
    );
  });
});
