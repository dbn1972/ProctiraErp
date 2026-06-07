'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';

const STEPS = ['personal', 'documents', 'review'] as const;
type Step = (typeof STEPS)[number];

/**
 * Presentation-only stepper for the multi-step apply flow, rendered in the
 * apply layout and driven by the current route:
 *   /apply/[type]            → personal (active)
 *   /apply/[type]/documents  → documents (active)
 *   /apply/[type]/review     → review (active)
 *
 * Completed steps show a filled primary circle with a check, the active step
 * a ringed primary circle, and upcoming steps a muted circle.
 */
export function ApplyStepper() {
  const t = useTranslations('registration');
  const pathname = usePathname();

  const current: Step = pathname.endsWith('/review')
    ? 'review'
    : pathname.endsWith('/documents')
      ? 'documents'
      : 'personal';
  const currentIndex = STEPS.indexOf(current);

  const labels: Record<Step, string> = {
    personal: t('personalInfo'),
    documents: t('documents'),
    review: t('review'),
  };

  return (
    <ol
      className="flex items-center justify-center"
      role="list"
      aria-label={t('stepLabel', { current: currentIndex + 1, total: STEPS.length })}
    >
      {STEPS.map((step, index) => {
        const isActive = index === currentIndex;
        const isDone = index < currentIndex;
        return (
          <li key={step} className="flex items-center">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`mx-2 h-0.5 w-8 sm:w-12 ${isDone ? 'bg-primary-600' : 'bg-gray-200'}`}
              />
            )}
            <div className="flex items-center gap-2">
              <span
                aria-current={isActive ? 'step' : undefined}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  isDone
                    ? 'bg-primary-600 text-white'
                    : isActive
                      ? 'bg-white text-primary-700 ring-2 ring-primary-600'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {isDone ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={`hidden text-sm font-semibold sm:inline ${
                  isActive ? 'text-gray-900' : isDone ? 'text-primary-700' : 'text-gray-400'
                }`}
              >
                {labels[step]}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
