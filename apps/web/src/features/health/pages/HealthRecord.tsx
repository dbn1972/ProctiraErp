/**
 * HealthRecord — student-scoped health records with tabbed navigation.
 *
 * Displays a student's health data across tabs:
 *   - Profile (measurements)
 *   - Allergies
 *   - Conditions
 *   - Vaccinations
 *   - Screenings (screening programs)
 *   - Referrals
 *
 * Wired to the Health Service API (Task 15):
 *   - GET /api/v1/health/measurements/student/:studentId
 *   - GET /api/v1/health/allergies/student/:studentId
 *   - GET /api/v1/health/conditions/student/:studentId
 *   - GET /api/v1/health/vaccinations/student/:studentId
 *   - GET /api/v1/health/special-needs/referrals/student/:studentId
 *   - GET /api/v1/health/screening-programs
 *
 * Access control: Requirement 12.4 — route-level enforcement.
 * Unauthorized users see a 403 page, not blanked content.
 *
 * Requirements: 12.1, 12.4, 12.5
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface Measurement {
  id: string;
  studentId: string;
  date: string;
  height: number | null;
  weight: number | null;
  bmi: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  heartRate: number | null;
  visionLeft: string | null;
  visionRight: string | null;
  notes: string | null;
  createdAt: string;
}

interface Allergy {
  id: string;
  studentId: string;
  allergyType: string;
  description: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening';
  reaction: string | null;
  treatment: string | null;
  diagnosedDate: string | null;
  createdAt: string;
}

interface Condition {
  id: string;
  studentId: string;
  conditionName: string;
  conditionType: string;
  diagnosedDate: string | null;
  status: 'active' | 'managed' | 'resolved';
  treatment: string | null;
  medication: string | null;
  notes: string | null;
  createdAt: string;
}

interface Vaccination {
  id: string;
  studentId: string;
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  administeredBy: string | null;
  batchNumber: string | null;
  nextDueDate: string | null;
  notes: string | null;
  createdAt: string;
}

interface Referral {
  id: string;
  studentId: string;
  diagnosisId: string | null;
  referralDate: string;
  referredBy: string;
  referredTo: string;
  reason: string;
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled';
  appointmentDate: string | null;
  outcome: string | null;
  createdAt: string;
}

interface ScreeningProgram {
  id: string;
  name: string;
  description: string | null;
  gradeLevel: string;
  academicPeriodId: string;
  assessmentTypes: string[];
  scheduledDate: string | null;
  status: 'planned' | 'in-progress' | 'completed' | 'cancelled';
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

type TabKey = 'profile' | 'allergies' | 'conditions' | 'vaccinations' | 'screenings' | 'referrals';

/* ------------------------------------------------------------------ Helpers */

const SEVERITY_STYLES: Record<string, string> = {
  mild: 'bg-green-100 text-green-700',
  moderate: 'bg-yellow-100 text-yellow-700',
  severe: 'bg-orange-100 text-orange-700',
  'life-threatening': 'bg-red-100 text-red-700',
};

const CONDITION_STATUS_STYLES: Record<string, string> = {
  active: 'bg-red-100 text-red-700',
  managed: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
};

const REFERRAL_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  scheduled: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

const SCREENING_STATUS_STYLES: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-700',
  'in-progress': 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ------------------------------------------------------------------ Component */

export default function HealthRecord() {
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = searchParams.get('studentId') ?? '';
  const activeTab = (searchParams.get('tab') as TabKey) || 'profile';

  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [screenings, setScreenings] = useState<ScreeningProgram[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const setTab = (tab: TabKey) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    setSearchParams(params);
  };

  const fetchTabData = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      switch (activeTab) {
        case 'profile': {
          const res = await browserGatewayFetch<PaginatedResponse<Measurement>>(
            `/health/measurements/student/${studentId}?pageSize=50`,
          );
          setMeasurements(res.data);
          break;
        }
        case 'allergies': {
          const res = await browserGatewayFetch<PaginatedResponse<Allergy>>(
            `/health/allergies/student/${studentId}?pageSize=50`,
          );
          setAllergies(res.data);
          break;
        }
        case 'conditions': {
          const res = await browserGatewayFetch<PaginatedResponse<Condition>>(
            `/health/conditions/student/${studentId}?pageSize=50`,
          );
          setConditions(res.data);
          break;
        }
        case 'vaccinations': {
          const res = await browserGatewayFetch<PaginatedResponse<Vaccination>>(
            `/health/vaccinations/student/${studentId}?pageSize=50`,
          );
          setVaccinations(res.data);
          break;
        }
        case 'referrals': {
          const res = await browserGatewayFetch<PaginatedResponse<Referral>>(
            `/health/special-needs/referrals/student/${studentId}?pageSize=50`,
          );
          setReferrals(res.data);
          break;
        }
        case 'screenings': {
          const res = await browserGatewayFetch<PaginatedResponse<ScreeningProgram>>(
            `/health/screening-programs?pageSize=50`,
          );
          setScreenings(res.data);
          break;
        }
      }
    } catch (err) {
      if (err instanceof BrowserGatewayError && err.status === 403) {
        setForbidden(true);
      } else if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load health records');
      }
    } finally {
      setLoading(false);
    }
  }, [studentId, activeTab]);

  useEffect(() => {
    void fetchTabData();
  }, [fetchTabData]);

  // ─── 403 Forbidden page (Requirement 12.4) ─────────────────────────────
  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-6">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-semibold">Access Denied</h1>
        <p className="text-muted-foreground text-center max-w-md">
          You do not have permission to view health records. Only authorized health
          personnel and the student&apos;s guardian may access this information.
        </p>
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Health Records</h1>
        <p className="text-muted-foreground mt-2">
          Select a student to view their health records.
        </p>
      </div>
    );
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'profile', label: 'Measurements' },
    { key: 'allergies', label: 'Allergies' },
    { key: 'conditions', label: 'Conditions' },
    { key: 'vaccinations', label: 'Vaccinations' },
    { key: 'screenings', label: 'Screenings' },
    { key: 'referrals', label: 'Referrals' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Health Records</h1>
        <p className="text-muted-foreground mt-1">
          Student health data including measurements, allergies, conditions, and vaccinations.
        </p>
      </div>

      {/* Tab navigation */}
      <nav className="flex gap-1 border-b" aria-label="Health record tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            aria-selected={activeTab === tab.key}
            role="tab"
          >
            {tab.label}
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
        <div role="status" aria-label="Loading health records" className="text-muted-foreground text-sm">
          Loading…
        </div>
      )}

      {/* Tab content */}
      {!loading && !error && (
        <div role="tabpanel">
          {activeTab === 'profile' && <MeasurementsPanel data={measurements} />}
          {activeTab === 'allergies' && <AllergiesPanel data={allergies} />}
          {activeTab === 'conditions' && <ConditionsPanel data={conditions} />}
          {activeTab === 'vaccinations' && <VaccinationsPanel data={vaccinations} />}
          {activeTab === 'screenings' && <ScreeningsPanel data={screenings} />}
          {activeTab === 'referrals' && <ReferralsPanel data={referrals} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Panels */

function MeasurementsPanel({ data }: { data: Measurement[] }) {
  if (data.length === 0) {
    return <EmptyState message="No measurements recorded." />;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Date</th>
            <th className="px-4 py-3 text-right font-medium">Height (cm)</th>
            <th className="px-4 py-3 text-right font-medium">Weight (kg)</th>
            <th className="px-4 py-3 text-right font-medium">BMI</th>
            <th className="px-4 py-3 text-right font-medium">BP</th>
            <th className="px-4 py-3 text-right font-medium">Heart Rate</th>
            <th className="px-4 py-3 text-left font-medium">Vision (L/R)</th>
            <th className="px-4 py-3 text-left font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((m) => (
            <tr key={m.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">{formatDate(m.date)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{m.height ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{m.weight ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{m.bmi ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {m.bloodPressureSystolic != null && m.bloodPressureDiastolic != null
                  ? `${m.bloodPressureSystolic}/${m.bloodPressureDiastolic}`
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{m.heartRate ?? '—'}</td>
              <td className="px-4 py-3">
                {m.visionLeft || m.visionRight
                  ? `${m.visionLeft ?? '—'} / ${m.visionRight ?? '—'}`
                  : '—'}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground line-clamp-1">
                {m.notes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllergiesPanel({ data }: { data: Allergy[] }) {
  if (data.length === 0) {
    return <EmptyState message="No allergies recorded." />;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Description</th>
            <th className="px-4 py-3 text-left font-medium">Severity</th>
            <th className="px-4 py-3 text-left font-medium">Reaction</th>
            <th className="px-4 py-3 text-left font-medium">Treatment</th>
            <th className="px-4 py-3 text-left font-medium">Diagnosed</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((a) => (
            <tr key={a.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">{a.allergyType}</td>
              <td className="px-4 py-3">{a.description}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[a.severity] ?? ''}`}>
                  {a.severity}
                </span>
              </td>
              <td className="px-4 py-3 text-xs">{a.reaction ?? '—'}</td>
              <td className="px-4 py-3 text-xs">{a.treatment ?? '—'}</td>
              <td className="px-4 py-3 text-xs">{a.diagnosedDate ? formatDate(a.diagnosedDate) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConditionsPanel({ data }: { data: Condition[] }) {
  if (data.length === 0) {
    return <EmptyState message="No health conditions recorded." />;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Condition</th>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Diagnosed</th>
            <th className="px-4 py-3 text-left font-medium">Treatment</th>
            <th className="px-4 py-3 text-left font-medium">Medication</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((c) => (
            <tr key={c.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">{c.conditionName}</td>
              <td className="px-4 py-3 text-xs">{c.conditionType}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CONDITION_STATUS_STYLES[c.status] ?? ''}`}>
                  {c.status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs">{c.diagnosedDate ? formatDate(c.diagnosedDate) : '—'}</td>
              <td className="px-4 py-3 text-xs line-clamp-1">{c.treatment ?? '—'}</td>
              <td className="px-4 py-3 text-xs">{c.medication ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VaccinationsPanel({ data }: { data: Vaccination[] }) {
  if (data.length === 0) {
    return <EmptyState message="No vaccinations recorded." />;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Vaccine</th>
            <th className="px-4 py-3 text-right font-medium">Dose #</th>
            <th className="px-4 py-3 text-left font-medium">Date</th>
            <th className="px-4 py-3 text-left font-medium">Administered By</th>
            <th className="px-4 py-3 text-left font-medium">Batch #</th>
            <th className="px-4 py-3 text-left font-medium">Next Due</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((v) => (
            <tr key={v.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">{v.vaccineName}</td>
              <td className="px-4 py-3 text-right tabular-nums">{v.doseNumber}</td>
              <td className="px-4 py-3 text-xs">{formatDate(v.dateAdministered)}</td>
              <td className="px-4 py-3 text-xs">{v.administeredBy ?? '—'}</td>
              <td className="px-4 py-3 text-xs">{v.batchNumber ?? '—'}</td>
              <td className="px-4 py-3 text-xs">{v.nextDueDate ? formatDate(v.nextDueDate) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScreeningsPanel({ data }: { data: ScreeningProgram[] }) {
  if (data.length === 0) {
    return <EmptyState message="No screening programs configured." />;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Program</th>
            <th className="px-4 py-3 text-left font-medium">Grade Level</th>
            <th className="px-4 py-3 text-left font-medium">Assessment Types</th>
            <th className="px-4 py-3 text-left font-medium">Scheduled</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="font-medium">{s.name}</div>
                {s.description && (
                  <div className="text-muted-foreground text-xs mt-0.5 line-clamp-1">{s.description}</div>
                )}
              </td>
              <td className="px-4 py-3 text-xs">{s.gradeLevel}</td>
              <td className="px-4 py-3 text-xs">{s.assessmentTypes.join(', ')}</td>
              <td className="px-4 py-3 text-xs">{s.scheduledDate ? formatDate(s.scheduledDate) : '—'}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SCREENING_STATUS_STYLES[s.status] ?? ''}`}>
                  {s.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReferralsPanel({ data }: { data: Referral[] }) {
  if (data.length === 0) {
    return <EmptyState message="No referrals recorded." />;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Date</th>
            <th className="px-4 py-3 text-left font-medium">Referred By</th>
            <th className="px-4 py-3 text-left font-medium">Referred To</th>
            <th className="px-4 py-3 text-left font-medium">Reason</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Appointment</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 text-xs">{formatDate(r.referralDate)}</td>
              <td className="px-4 py-3 text-xs">{r.referredBy}</td>
              <td className="px-4 py-3 text-xs">{r.referredTo}</td>
              <td className="px-4 py-3 text-xs line-clamp-1">{r.reason}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${REFERRAL_STATUS_STYLES[r.status] ?? ''}`}>
                  {r.status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs">{r.appointmentDate ? formatDate(r.appointmentDate) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground text-sm">{message}</div>
  );
}
