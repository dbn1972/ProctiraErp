'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

const STEPS = ['personal', 'documents', 'review'] as const;
export type RegistrationStep = (typeof STEPS)[number];

/**
 * Horizontal step indicator for the multi-page apply flow.
 * Steps: Personal info → Documents → Review.
 */
export function StepIndicator({ currentStep }: { currentStep: RegistrationStep }) {
  const t = useTranslations('registration');
  const stepLabels: Record<RegistrationStep, string> = {
    personal: t('personalInfo'),
    documents: t('documents'),
    review: t('review'),
  };
  const currentIndex = STEPS.indexOf(currentStep);

  return (
    <ol
      className="flex items-center justify-center gap-2"
      role="list"
      aria-label={t('stepLabel', { current: currentIndex + 1, total: STEPS.length })}
    >
      {STEPS.map((step, index) => {
        const isActive = step === currentStep;
        const isPast = index < currentIndex;
        return (
          <li key={step} className="flex items-center">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`mx-2 h-0.5 w-8 ${isPast ? 'bg-primary-600' : 'bg-gray-200'}`}
              />
            )}
            <div className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : isPast
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-200 text-gray-500'
                }`}
                aria-current={isActive ? 'step' : undefined}
              >
                {isPast ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={`hidden text-sm sm:inline ${
                  isActive ? 'font-medium text-gray-900' : 'text-gray-500'
                }`}
              >
                {stepLabels[step]}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
