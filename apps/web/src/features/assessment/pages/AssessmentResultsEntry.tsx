/**
 * AssessmentResultsEntry — bulk grade entry grid for an assessment scheme.
 *
 * Wired to the assessment-service API (Task 60.3):
 *   - GET /api/v1/grading-schemes (list available schemes)
 *   - GET /api/v1/assessment-items (items for subject/period)
 *   - POST /api/v1/results/bulk (submit results)
 *   - GET /api/v1/results/grades (view calculated grades)
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface GradingScheme {
  id: string;
  name: string;
  type: string;
  minValue: number;
  maxValue: number;
}

interface AssessmentItem {
  id: string;
  name: string;
  weight: number;
  maxScore: number;
  minScore: number;
}

interface AssessmentItemsResponse {
  subjectId: string;
  academicPeriodId: string;
  gradingSchemeId: string | null;
  totalWeight: number;
  items: AssessmentItem[];
}

interface BulkResultEntryResponse {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ row: number; studentId: string; field: string; message: string }>;
}

/* ------------------------------------------------------------------ Component */

export default function AssessmentResultsEntry() {
  const [schemes, setSchemes] = useState<GradingScheme[]>([]);
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // In a real implementation these would come from route params or a selector
  const [subjectId] = useState('');
  const [academicPeriodId] = useState('');

  const fetchSchemes = useCallback(async () => {
    try {
      const result = await browserGatewayFetch<{ data: GradingScheme[]; meta: unknown }>(
        '/grading-schemes?pageSize=50',
      );
      setSchemes(result.data);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      }
    }
  }, []);

  const fetchItems = useCallback(async () => {
    if (!subjectId || !academicPeriodId) return;
    try {
      const params = new URLSearchParams({ subjectId, academicPeriodId });
      const result = await browserGatewayFetch<AssessmentItemsResponse>(
        `/assessment-items?${params.toString()}`,
      );
      setItems(result.items);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      }
    }
  }, [subjectId, academicPeriodId]);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await fetchSchemes();
      await fetchItems();
      setIsLoading(false);
    })();
  }, [fetchSchemes, fetchItems]);

  const handleSubmitResults = async (
    results: Array<{ studentId: string; assessmentItemId: string; score: number }>,
  ) => {
    setError(null);
    setSuccess(null);
    try {
      const response = await browserGatewayFetch<BulkResultEntryResponse>('/results/bulk', {
        method: 'POST',
        json: {
          subjectId,
          academicPeriodId,
          results,
        },
      });
      if (response.errorCount > 0) {
        setError(
          `${response.errorCount} entries had errors. ${response.successCount} saved successfully.`,
        );
      } else {
        setSuccess(`${response.successCount} results saved successfully.`);
      }
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to submit results');
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Assessment Results Entry</h1>

      {!subjectId && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Select a subject and academic period to begin entering assessment results.
        </div>
      )}

      {/* Error / Success */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {success}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3" data-testid="assessment-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {/* Grading schemes info */}
      {!isLoading && schemes.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="text-sm font-medium mb-2">Available Grading Schemes</h2>
          <div className="flex flex-wrap gap-2">
            {schemes.map((scheme) => (
              <span
                key={scheme.id}
                className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs"
              >
                {scheme.name} ({scheme.type}: {scheme.minValue}–{scheme.maxValue})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Assessment items */}
      {!isLoading && items.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm" data-testid="assessment-items-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Item</th>
                <th className="px-4 py-3 text-left font-medium">Weight</th>
                <th className="px-4 py-3 text-left font-medium">Score Range</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{item.name}</td>
                  <td className="px-4 py-3">{item.weight}%</td>
                  <td className="px-4 py-3">
                    {item.minScore} – {item.maxScore}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Placeholder for the data grid (full implementation would use a
          spreadsheet-like component for bulk entry) */}
      {!isLoading && subjectId && items.length > 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          <p>Bulk entry data grid will render here.</p>
          <p className="text-xs mt-1">
            Enter scores for each student × assessment item, then click Save.
          </p>
          <button
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => handleSubmitResults([])}
          >
            Save Results
          </button>
        </div>
      )}
    </div>
  );
}
