/**
 * StepIndicator — visual progress indicator for the import wizard steps.
 * Accessible via aria-current and aria-label attributes.
 */
'use client';

import type { ImportWizardStep } from './types';

interface StepIndicatorProps {
  currentStep: ImportWizardStep;
}

const STEPS: { key: ImportWizardStep; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'mapping', label: 'Map Columns' },
  { key: 'validation', label: 'Review' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'confirmation', label: 'Confirm' },
];

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav aria-label="Import wizard progress">
      <ol className="flex items-center gap-2 text-sm">
        {STEPS.map((step, index) => {
          const isActive = index === currentIndex;
          const isComplete = index < currentIndex;

          return (
            <li
              key={step.key}
              className="flex items-center gap-1"
              aria-current={isActive ? 'step' : undefined}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  isComplete
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-2 border-primary text-primary'
                      : 'border border-muted-foreground/30 text-muted-foreground'
                }`}
                aria-hidden="true"
              >
                {isComplete ? '✓' : index + 1}
              </span>
              <span
                className={`hidden sm:inline ${
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
              {index < STEPS.length - 1 && (
                <span
                  className={`mx-1 h-px w-4 sm:w-8 ${
                    isComplete ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default StepIndicator;
