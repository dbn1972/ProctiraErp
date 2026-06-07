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
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/assessments">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to assessments
        </Link>
      </Button>

      <div>
        <h1
          id="new-scheme-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          New grading scheme
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Numeric, letter, or competency-based scheme. Define thresholds that
          map score ranges to grade labels.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Scheme definition</CardTitle>
          <CardDescription>
            Set the scale type, value range, and the grade bands that map scores
            to labels.
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
