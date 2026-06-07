/**
 * /assessments/schemes/new — Create grading scheme.
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

import { GradingSchemeForm } from '../../_components/grading-scheme-form';

export const dynamic = 'force-dynamic';

export default function NewGradingSchemePage() {
  return (
    <section aria-labelledby="new-scheme-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/assessments">
          <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
          Back to assessments
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle id="new-scheme-heading">New grading scheme</CardTitle>
          <CardDescription>
            Numeric, letter, or competency-based scheme. Define thresholds that
            map score ranges to grade labels (Requirement 8.1).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GradingSchemeForm
            mode="create"
            initialValues={{
              name: '',
              type: 'numeric',
              minValue: 0,
              maxValue: 100,
              thresholds: [
                { grade: 'A', minScore: 80, maxScore: 100, descriptor: '' },
                { grade: 'B', minScore: 60, maxScore: 79.99, descriptor: '' },
                { grade: 'C', minScore: 0, maxScore: 59.99, descriptor: '' },
              ],
            }}
          />
        </CardContent>
      </Card>
    </section>
  );
}
