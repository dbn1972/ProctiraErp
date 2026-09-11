import { ReviewStep } from '@/components/registration/review-step';

interface PageProps {
  params: Promise<{ institutionType: string }>;
}

/**
 * Step 3 — Review and submit page.
 */
export default async function ApplyReviewPage({ params }: PageProps) {
  const { institutionType } = await params;
  return (
    <div className="space-y-6">
      <ReviewStep institutionType={institutionType} />
    </div>
  );
}
