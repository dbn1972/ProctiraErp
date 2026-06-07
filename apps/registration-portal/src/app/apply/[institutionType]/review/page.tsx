import { ReviewStep } from '@/components/registration/review-step';
import { StepIndicator } from '@/components/registration/step-indicator';

interface PageProps {
  params: { institutionType: string };
}

/**
 * Step 3 — Review and submit page.
 */
export default function ApplyReviewPage({ params }: PageProps) {
  return (
    <div className="space-y-6">
      <StepIndicator currentStep="review" />
      <ReviewStep institutionType={params.institutionType} />
    </div>
  );
}
