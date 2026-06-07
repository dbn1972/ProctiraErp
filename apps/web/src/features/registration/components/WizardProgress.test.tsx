/**
 * @vitest-environment jsdom
 *
 * <WizardProgress> unit tests — Task 51.2 / Requirements 16.8, 37.3,
 * 37.6 / Design §F, K, L.
 *
 * Covers:
 *   • Renders one numbered pill per step with the supplied label and
 *     reflects the three visual states (completed / active / upcoming)
 *     via `data-status`.
 *   • The active pill is the source of truth for screen readers
 *     (carries `aria-current="step"` and `aria-label="Step n of N: …"`).
 *   • The decorative progress bar is `aria-hidden`.
 *   • On every `currentStep` change the component pushes a polite
 *     announcement through the global `<LiveRegion>` via `useAnnounce`.
 *   • Each clickable past-step pill is at least 48 × 48 px and exposes
 *     a focus-visible ring (Requirement 37 AC 3 + AC 6).
 *   • `onNavigate` is invoked with the step id when a completed pill
 *     is activated by mouse or keyboard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LiveRegion } from '@proctira/ui-components';

import { WizardProgress, type WizardProgressStep } from './WizardProgress';
import { WIZARD_STEPS, type WizardStep } from '../useRegistrationWizard';

const STEPS: WizardProgressStep[] = [
  { id: 'personal-info', label: 'Personal info' },
  { id: 'contact', label: 'Contact' },
  { id: 'school-selection', label: 'School preferences' },
  { id: 'documents', label: 'Documents' },
  { id: 'review', label: 'Review' },
];

function indexOf(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('<WizardProgress /> — labels and state', () => {
  it('renders one pill per step with the supplied label', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="personal-info"
        currentStepIndex={0}
        totalSteps={STEPS.length}
      />,
    );

    for (const step of STEPS) {
      expect(
        screen.getByTestId(`wizard-progress-pill-${step.id}`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`wizard-progress-label-${step.id}`).textContent,
      ).toBe(step.label);
    }
  });

  it('marks completed / active / upcoming states with data-status', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="school-selection"
        currentStepIndex={indexOf('school-selection')}
        totalSteps={STEPS.length}
      />,
    );

    expect(
      screen
        .getByTestId('wizard-progress-pill-personal-info')
        .getAttribute('data-status'),
    ).toBe('completed');
    expect(
      screen
        .getByTestId('wizard-progress-pill-contact')
        .getAttribute('data-status'),
    ).toBe('completed');
    expect(
      screen
        .getByTestId('wizard-progress-pill-school-selection')
        .getAttribute('data-status'),
    ).toBe('active');
    expect(
      screen
        .getByTestId('wizard-progress-pill-documents')
        .getAttribute('data-status'),
    ).toBe('upcoming');
    expect(
      screen
        .getByTestId('wizard-progress-pill-review')
        .getAttribute('data-status'),
    ).toBe('upcoming');
  });

  it('marks the active pill with aria-current="step" and aria-label "Step n of N"', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="contact"
        currentStepIndex={indexOf('contact')}
        totalSteps={STEPS.length}
      />,
    );

    const active = screen.getByTestId('wizard-progress-pill-contact');
    expect(active.getAttribute('aria-current')).toBe('step');
    expect(active.getAttribute('aria-label')).toBe('Step 2 of 5: Contact');

    // Other pills must not carry aria-current.
    expect(
      screen
        .getByTestId('wizard-progress-pill-personal-info')
        .getAttribute('aria-current'),
    ).toBeNull();
    expect(
      screen
        .getByTestId('wizard-progress-pill-documents')
        .getAttribute('aria-current'),
    ).toBeNull();
  });

  it('hides the decorative progress bar from screen readers', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="personal-info"
        currentStepIndex={0}
        totalSteps={STEPS.length}
      />,
    );

    const bar = screen.getByTestId('wizard-progress-bar');
    expect(bar.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('<WizardProgress /> — useAnnounce dispatch', () => {
  it('announces the current step on mount via the polite live region', () => {
    render(<LiveRegion />);
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="personal-info"
        currentStepIndex={0}
        totalSteps={STEPS.length}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('live-region-polite').textContent).toBe(
      'Step 1 of 5: Personal info',
    );
  });

  it('announces the new step when currentStep changes', () => {
    render(<LiveRegion />);
    const { rerender } = render(
      <WizardProgress
        steps={STEPS}
        currentStep="personal-info"
        currentStepIndex={0}
        totalSteps={STEPS.length}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('live-region-polite').textContent).toBe(
      'Step 1 of 5: Personal info',
    );

    rerender(
      <WizardProgress
        steps={STEPS}
        currentStep="contact"
        currentStepIndex={1}
        totalSteps={STEPS.length}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('live-region-polite').textContent).toBe(
      'Step 2 of 5: Contact',
    );
  });

  it('does not re-announce when an unrelated prop changes', () => {
    render(<LiveRegion />);
    const onNavigate = vi.fn();
    const { rerender } = render(
      <WizardProgress
        steps={STEPS}
        currentStep="contact"
        currentStepIndex={1}
        totalSteps={STEPS.length}
        onNavigate={onNavigate}
      />,
    );

    // First announcement fires on mount.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('live-region-polite').textContent).toBe(
      'Step 2 of 5: Contact',
    );

    // Wait out the live-region debounce so a duplicate announcement
    // would be observable as a re-fill.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('live-region-polite').textContent).toBe('');

    // Re-render with the same currentStep but a different callback
    // identity. The component must not announce again.
    rerender(
      <WizardProgress
        steps={STEPS}
        currentStep="contact"
        currentStepIndex={1}
        totalSteps={STEPS.length}
        onNavigate={vi.fn()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('live-region-polite').textContent).toBe('');
  });
});

describe('<WizardProgress /> — touch targets and keyboard navigation', () => {
  it('renders past-step pills as focusable buttons with the 48 × 48 px floor', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="documents"
        currentStepIndex={indexOf('documents')}
        totalSteps={STEPS.length}
        onNavigate={() => undefined}
      />,
    );

    const pill = screen.getByTestId(
      'wizard-progress-pill-personal-info',
    ) as HTMLButtonElement;
    expect(pill.tagName).toBe('BUTTON');
    // 48 × 48 px touch target floor (Requirement 37 AC 3).
    expect(pill.className).toContain('min-h-[48px]');
    expect(pill.className).toContain('min-w-[48px]');
    // Focus-visible ring (Requirement 37 AC 6 + AC 5).
    expect(pill.className).toContain('focus-visible:ring-2');
  });

  it('keeps the active pill out of the tab order (no button)', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="contact"
        currentStepIndex={indexOf('contact')}
        totalSteps={STEPS.length}
        onNavigate={() => undefined}
      />,
    );

    const active = screen.getByTestId('wizard-progress-pill-contact');
    expect(active.tagName).not.toBe('BUTTON');
    // Still hits the touch-target floor for visual rhythm parity.
    expect(active.className).toContain('min-h-[48px]');
    expect(active.className).toContain('min-w-[48px]');
  });

  it('renders upcoming pills as non-interactive elements', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="contact"
        currentStepIndex={indexOf('contact')}
        totalSteps={STEPS.length}
        onNavigate={() => undefined}
      />,
    );

    const upcoming = screen.getByTestId('wizard-progress-pill-documents');
    expect(upcoming.tagName).not.toBe('BUTTON');
  });

  it('invokes onNavigate with the step id when a completed pill is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="documents"
        currentStepIndex={indexOf('documents')}
        totalSteps={STEPS.length}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(
      screen.getByTestId('wizard-progress-pill-personal-info'),
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('personal-info');
  });

  it('omits onNavigate handling on completed pills when no callback is supplied', () => {
    render(
      <WizardProgress
        steps={STEPS}
        currentStep="contact"
        currentStepIndex={indexOf('contact')}
        totalSteps={STEPS.length}
      />,
    );

    const completed = screen.getByTestId('wizard-progress-pill-personal-info');
    expect(completed.tagName).not.toBe('BUTTON');
  });
});
