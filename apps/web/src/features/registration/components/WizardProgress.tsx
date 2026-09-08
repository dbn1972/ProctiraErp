/**
 * apps/web/src/features/registration/components/WizardProgress.tsx —
 * Visual + accessible progress indicator for the public registration
 * wizard (Task 51.2, Requirements 16.8, 37.3, 37.6, Design §F, K, L).
 * =============================================================================
 *
 * `<WizardProgress>` mirrors the prototype's StudentEnrollment indicator
 * (numbered step pills with connector lines, three states:
 * completed / active / upcoming) and layers on the accessibility
 * affordances called out by Design §K and §L:
 *
 *   • Step pills are the source of truth for screen readers. The
 *     active pill carries `aria-current="step"` and an
 *     `aria-label="Step {n} of {total}: {label}"`.
 *   • The horizontal progress bar is decorative — it is mirrored on
 *     the pills and explicitly `aria-hidden`.
 *   • Each completed pill is a real `<button>` so a keyboard user can
 *     jump back to a prior step (the wizard's `goTo()` enforces that
 *     forward jumps are blocked). Buttons hit the 48 × 48 px touch
 *     target floor and expose a focus-visible ring (Requirement 37
 *     AC 3 + AC 6).
 *   • On every step change the component pushes a polite
 *     announcement through the global `<LiveRegion>` via
 *     `useAnnounce()` — e.g. "Step 2 of 5: Contact information".
 *
 * The component is **controlled**: it accepts `currentStep`,
 * `currentStepIndex`, and `totalSteps` plus the ordered `steps`
 * descriptor and an `onNavigate(step)` callback. It does not own the
 * state machine — that lives in `useRegistrationWizard`.
 */

import { Check } from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';

import { useAnnounce } from '@proctira/ui-components';

import type { WizardStep } from '../useRegistrationWizard';

/** Descriptor for one wizard step. */
export interface WizardProgressStep {
  /** Stable id, e.g. `'personal-info'`. */
  id: WizardStep;
  /** Visible label, e.g. `'Personal info'`. */
  label: string;
}

export interface WizardProgressProps {
  /** Ordered list of wizard steps. */
  steps: ReadonlyArray<WizardProgressStep>;
  /** The currently active step id. */
  currentStep: WizardStep;
  /** Zero-based index of the active step. */
  currentStepIndex: number;
  /** Total number of steps. Mirrors `steps.length` but is accepted
   * explicitly so callers can pass through `wizard.totalSteps`. */
  totalSteps: number;
  /**
   * Optional handler. When present, completed pills become real
   * `<button>` elements that call `onNavigate(stepId)` so the
   * keyboard user can jump back. The wizard's `goTo()` is the
   * gatekeeper for what jumps are allowed.
   */
  onNavigate?: (step: WizardStep) => void;
}

/** Three visual states for a step pill. */
type StepStatus = 'completed' | 'active' | 'upcoming';

function statusFor(index: number, currentIndex: number): StepStatus {
  if (index < currentIndex) return 'completed';
  if (index === currentIndex) return 'active';
  return 'upcoming';
}

/**
 * Render a numbered step pill plus its label. The completed state
 * shows a check icon; the active and upcoming states show the step
 * number. Every pill is a 48 × 48 px hit target so pointer + keyboard
 * users alike can activate it without missing.
 */
function StepPill({
  step,
  index,
  total,
  status,
  onNavigate,
}: {
  step: WizardProgressStep;
  index: number;
  total: number;
  status: StepStatus;
  onNavigate?: (step: WizardStep) => void;
}): JSX.Element {
  const isCompleted = status === 'completed';
  const isActive = status === 'active';

  // Completed pills are interactive when the parent supplies a
  // navigate callback — click / Enter / Space jump back to that
  // step. Active and upcoming pills are non-interactive `<div>`s so
  // they stay out of the keyboard tab order.
  const interactive = isCompleted && typeof onNavigate === 'function';

  // Common pill className. The 48 × 48 px floor is mandatory on the
  // interactive variant; we apply the same floor to the read-only
  // variant so the visual rhythm of the indicator stays uniform.
  const pillClass = [
    'flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-full text-sm font-semibold',
    isCompleted ? 'bg-success text-white' : null,
    isActive ? 'bg-primary text-primary-foreground ring-2 ring-primary/40' : null,
    !isCompleted && !isActive ? 'border-2 border-muted-foreground/30 text-muted-foreground' : null,
    interactive
      ? 'cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors'
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  // The label below the pill. The active step gets a stronger color
  // so the visual state is conveyed without relying on color alone
  // (Requirement 37 AC 7) — the icon swap and text weight back it up.
  const labelClass = [
    'mt-2 max-w-[7rem] text-center text-xs font-medium',
    isActive ? 'text-foreground' : null,
    isCompleted ? 'text-success' : null,
    !isCompleted && !isActive ? 'text-muted-foreground' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const ariaLabel = `Step ${index + 1} of ${total}: ${step.label}`;

  const inner = isCompleted ? (
    <Check className="h-5 w-5" aria-hidden="true" />
  ) : (
    <span aria-hidden="true">{index + 1}</span>
  );

  return (
    <div className="flex flex-col items-center" data-testid={`wizard-progress-item-${step.id}`}>
      {interactive ? (
        <button
          type="button"
          className={pillClass}
          aria-label={ariaLabel}
          data-testid={`wizard-progress-pill-${step.id}`}
          data-status={status}
          onClick={() => onNavigate?.(step.id)}
        >
          {inner}
        </button>
      ) : (
        <div
          role="presentation"
          className={pillClass}
          aria-label={ariaLabel}
          {...(isActive ? { 'aria-current': 'step' as const } : {})}
          data-testid={`wizard-progress-pill-${step.id}`}
          data-status={status}
        >
          {inner}
        </div>
      )}
      <span className={labelClass} data-testid={`wizard-progress-label-${step.id}`}>
        {step.label}
      </span>
    </div>
  );
}

/**
 * Connector line between two adjacent pills. Filled in success when
 * the prior step is completed. Decorative — the pills carry the
 * accessible state.
 */
function Connector({ filled }: { filled: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`mt-6 h-0.5 flex-1 ${filled ? 'bg-success' : 'bg-muted'}`}
      data-testid="wizard-progress-connector"
      data-filled={filled ? 'true' : 'false'}
    />
  );
}

/**
 * Visual + accessible wizard progress indicator. Composes the step
 * pills with a continuous progress bar; on every `currentStep`
 * change emits a polite screen-reader announcement.
 *
 * Validates: Requirements 16.8, 37.3, 37.6 — Design F, K, L.
 */
export function WizardProgress({
  steps,
  currentStep,
  currentStepIndex,
  totalSteps,
  onNavigate,
}: WizardProgressProps): JSX.Element {
  const announce = useAnnounce();

  // Track the last announced step to avoid a duplicate announcement
  // on remount or when an unrelated re-render fires the effect.
  const lastAnnouncedRef = useRef<WizardStep | null>(null);

  useEffect(() => {
    if (lastAnnouncedRef.current === currentStep) return;
    lastAnnouncedRef.current = currentStep;
    const label = steps.find((step) => step.id === currentStep)?.label ?? currentStep;
    announce(`Step ${currentStepIndex + 1} of ${totalSteps}: ${label}`, 'polite');
  }, [announce, currentStep, currentStepIndex, totalSteps, steps]);

  // Visual progress percentage for the underlay bar. Caps at 100 % on
  // the last step. The bar is `aria-hidden` because the pills carry
  // the accessible state.
  const progressPercent =
    totalSteps <= 1 ? 100 : Math.round((currentStepIndex / (totalSteps - 1)) * 100);

  return (
    <nav aria-label="Registration progress" data-testid="wizard-progress" className="space-y-3">
      {/* Decorative progress bar. The pills below are the source of
          truth for screen readers, so this is intentionally hidden
          from assistive tech. */}
      <div
        aria-hidden="true"
        data-testid="wizard-progress-bar"
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${progressPercent}%` }}
          data-testid="wizard-progress-bar-fill"
          data-progress={progressPercent}
        />
      </div>
      <ol
        className="flex items-start gap-2"
        aria-label="Registration steps"
        data-testid="wizard-progress-list"
      >
        {steps.map((step, index) => {
          const status = statusFor(index, currentStepIndex);
          const isLast = index === steps.length - 1;
          return (
            <Fragment key={step.id}>
              <li
                className="flex flex-col items-center"
                data-testid={`wizard-progress-step-${step.id}`}
              >
                <StepPill
                  step={step}
                  index={index}
                  total={totalSteps}
                  status={status}
                  {...(onNavigate ? { onNavigate } : {})}
                />
              </li>
              {!isLast ? <Connector filled={status === 'completed'} /> : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

export default WizardProgress;
