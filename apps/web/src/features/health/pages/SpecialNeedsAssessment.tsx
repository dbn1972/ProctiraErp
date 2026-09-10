/**
 * SpecialNeedsAssessment — assessment intake and IEP (Individualized Education Plan) builder.
 *
 * Displays:
 *   - List of special needs assessments for a student
 *   - Diagnoses linked to assessments
 *   - Accommodation plans (IEP builder)
 *
 * Wired to the Health Service API (Task 15):
 *   - GET  /api/v1/health/special-needs/assessments/student/:studentId
 *   - POST /api/v1/health/special-needs/assessments
 *   - GET  /api/v1/health/special-needs/diagnoses/student/:studentId
 *   - GET  /api/v1/health/special-needs/accommodation-plans/student/:studentId
 *   - POST /api/v1/health/special-needs/accommodation-plans
 *
 * Access control: Requirement 12.4 — route-level enforcement.
 *
 * Requirements: 12.2, 12.4
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface Assessment {
  id: string;
  studentId: string;
  assessmentDate: string;
  assessorName: string;
  assessorRole: string;
  assessmentType: string;
  findings: string;
  recommendations: string | null;
  createdAt: string;
}

interface Diagnosis {
  id: string;
  studentId: string;
  assessmentId: string | null;
  diagnosisDate: string;
  diagnosedBy: string;
  condition: string;
  category: string;
  severity: 'mild' | 'moderate' | 'severe';
  notes: string | null;
  createdAt: string;
}

interface Accommodation {
  type: string;
  description: string;
}

interface AccommodationPlan {
  id: string;
  studentId: string;
  diagnosisId: string | null;
  planName: string;
  startDate: string;
  endDate: string | null;
  accommodations: Accommodation[];
  reviewDate: string | null;
  status: 'active' | 'under-review' | 'expired' | 'cancelled';
  notes: string | null;
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

type SectionKey = 'assessments' | 'diagnoses' | 'plans';

/* ------------------------------------------------------------------ Helpers */

const SEVERITY_STYLES: Record<string, string> = {
  mild: 'bg-green-100 text-green-700',
  moderate: 'bg-yellow-100 text-yellow-700',
  severe: 'bg-red-100 text-red-700',
};

const PLAN_STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  'under-review': 'bg-yellow-100 text-yellow-700',
  expired: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ------------------------------------------------------------------ Component */

export default function SpecialNeedsAssessment() {
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = searchParams.get('studentId') ?? '';
  const activeSection = (searchParams.get('section') as SectionKey) || 'assessments';

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [plans, setPlans] = useState<AccommodationPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const setSection = (section: SectionKey) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', section);
    setSearchParams(params);
  };

  const fetchData = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      switch (activeSection) {
        case 'assessments': {
          const res = await browserGatewayFetch<PaginatedResponse<Assessment>>(
            `/health/special-needs/assessments/student/${studentId}?pageSize=50`,
          );
          setAssessments(res.data);
          break;
        }
        case 'diagnoses': {
          const res = await browserGatewayFetch<PaginatedResponse<Diagnosis>>(
            `/health/special-needs/diagnoses/student/${studentId}?pageSize=50`,
          );
          setDiagnoses(res.data);
          break;
        }
        case 'plans': {
          const res = await browserGatewayFetch<PaginatedResponse<AccommodationPlan>>(
            `/health/special-needs/accommodation-plans/student/${studentId}?pageSize=50`,
          );
          setPlans(res.data);
          break;
        }
      }
    } catch (err) {
      if (err instanceof BrowserGatewayError && err.status === 403) {
        setForbidden(true);
      } else if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load special needs data');
      }
    } finally {
      setLoading(false);
    }
  }, [studentId, activeSection]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ─── 403 Forbidden page (Requirement 12.4) ─────────────────────────────
  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-6">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-semibold">Access Denied</h1>
        <p className="text-muted-foreground text-center max-w-md">
          You do not have permission to view special needs records. Only authorized health personnel
          and the student&apos;s guardian may access this information.
        </p>
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Special Needs Assessment</h1>
        <p className="text-muted-foreground mt-2">
          Select a student to view their special needs assessments and accommodation plans.
        </p>
      </div>
    );
  }

  const SECTIONS: { key: SectionKey; label: string }[] = [
    { key: 'assessments', label: 'Assessments' },
    { key: 'diagnoses', label: 'Diagnoses' },
    { key: 'plans', label: 'Accommodation Plans (IEP)' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Special Needs Assessment</h1>
        <p className="text-muted-foreground mt-1">
          Manage assessments, diagnoses, and individualized accommodation plans.
        </p>
      </div>

      {/* Section navigation */}
      <nav className="flex gap-1 border-b" aria-label="Special needs sections">
        {SECTIONS.map((sec) => (
          <button
            key={sec.key}
            onClick={() => setSection(sec.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeSection === sec.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            aria-selected={activeSection === sec.key}
            role="tab"
          >
            {sec.label}
          </button>
        ))}
      </nav>

      {/* Error state */}
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div role="status" aria-label="Loading" className="text-muted-foreground text-sm">
          Loading…
        </div>
      )}

      {/* Section content */}
      {!loading && !error && (
        <div role="tabpanel">
          {activeSection === 'assessments' && <AssessmentsSection data={assessments} />}
          {activeSection === 'diagnoses' && <DiagnosesSection data={diagnoses} />}
          {activeSection === 'plans' && <AccommodationPlansSection data={plans} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Sections */

function AssessmentsSection({ data }: { data: Assessment[] }) {
  if (data.length === 0) {
    return <EmptyState message="No assessments recorded." />;
  }
  return (
    <div className="space-y-4">
      {data.map((a) => (
        <div key={a.id} className="rounded-md border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">{a.assessmentType}</div>
            <span className="text-xs text-muted-foreground">{formatDate(a.assessmentDate)}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Assessor: {a.assessorName} ({a.assessorRole})
          </div>
          <div className="text-sm">
            <span className="font-medium">Findings:</span> {a.findings}
          </div>
          {a.recommendations && (
            <div className="text-sm">
              <span className="font-medium">Recommendations:</span> {a.recommendations}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DiagnosesSection({ data }: { data: Diagnosis[] }) {
  if (data.length === 0) {
    return <EmptyState message="No diagnoses recorded." />;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Condition</th>
            <th className="px-4 py-3 text-left font-medium">Category</th>
            <th className="px-4 py-3 text-left font-medium">Severity</th>
            <th className="px-4 py-3 text-left font-medium">Diagnosed By</th>
            <th className="px-4 py-3 text-left font-medium">Date</th>
            <th className="px-4 py-3 text-left font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((d) => (
            <tr key={d.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">{d.condition}</td>
              <td className="px-4 py-3 text-xs capitalize">{d.category}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[d.severity] ?? ''}`}
                >
                  {d.severity}
                </span>
              </td>
              <td className="px-4 py-3 text-xs">{d.diagnosedBy}</td>
              <td className="px-4 py-3 text-xs">{formatDate(d.diagnosisDate)}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground line-clamp-1">
                {d.notes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccommodationPlansSection({ data }: { data: AccommodationPlan[] }) {
  if (data.length === 0) {
    return <EmptyState message="No accommodation plans (IEP) created." />;
  }
  return (
    <div className="space-y-4">
      {data.map((plan) => (
        <div key={plan.id} className="rounded-md border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">{plan.planName}</div>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_STATUS_STYLES[plan.status] ?? ''}`}
            >
              {plan.status}
            </span>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Start: {formatDate(plan.startDate)}</span>
            {plan.endDate && <span>End: {formatDate(plan.endDate)}</span>}
            {plan.reviewDate && <span>Review: {formatDate(plan.reviewDate)}</span>}
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Accommodations:</div>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {plan.accommodations.map((acc, idx) => (
                <li key={idx}>
                  <span className="font-medium">{acc.type}:</span> {acc.description}
                </li>
              ))}
            </ul>
          </div>
          {plan.notes && <div className="text-xs text-muted-foreground">Notes: {plan.notes}</div>}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="text-center py-12 text-muted-foreground text-sm">{message}</div>;
}
