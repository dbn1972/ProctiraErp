/**
 * ScholarshipApplication — applicant-facing multi-step application form.
 *
 * Steps:
 *   1. Select Program — choose from open scholarship programs
 *   2. Academic Records — enter education history and GPA
 *   3. Financial Information — family income, dependents, employment
 *   4. Documents — upload required supporting documents
 *   5. Review & Submit — confirm all details before submission
 *
 * Wired to the Scholarship Service API (Task 14):
 *   - GET  /api/v1/scholarships/programs (open programs)
 *   - POST /api/v1/scholarships/applications
 *
 * Requirements: 11.2, 11.3
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface ScholarshipProgramSummary {
  id: string;
  name: string;
  description: string | null;
  applicationStartDate: string;
  applicationEndDate: string;
  totalSlots: number;
  usedSlots: number;
  amountPerRecipient: number;
  currency: string;
  eligibility: {
    minGPA?: number;
    maxAge?: number;
    requiredDocuments?: string[];
  };
}

interface AcademicRecord {
  institutionName: string;
  educationLevel: string;
  gpa?: number;
  yearCompleted?: number;
  fieldOfStudy?: string;
}

interface FinancialInfo {
  familyIncome?: number;
  numberOfDependents?: number;
  employmentStatus?: 'employed' | 'unemployed' | 'self_employed' | 'student';
  otherScholarships?: Array<{ name: string; amount: number }>;
}

interface ApplicationDocument {
  documentType: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
}

type Step = 'program' | 'academic' | 'financial' | 'documents' | 'review';

const STEPS: { key: Step; label: string }[] = [
  { key: 'program', label: 'Select Program' },
  { key: 'academic', label: 'Academic Records' },
  { key: 'financial', label: 'Financial Info' },
  { key: 'documents', label: 'Documents' },
  { key: 'review', label: 'Review & Submit' },
];

/* ------------------------------------------------------------------ Component */

export default function ScholarshipApplication() {
  const [currentStep, setCurrentStep] = useState<Step>('program');
  const [programs, setPrograms] = useState<ScholarshipProgramSummary[]>([]);
  const [loadingPrograms, setLoadingPrograms] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Form state
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [academicRecords, setAcademicRecords] = useState<AcademicRecord[]>([
    { institutionName: '', educationLevel: '', gpa: undefined, yearCompleted: undefined, fieldOfStudy: '' },
  ]);
  const [financialInfo, setFinancialInfo] = useState<FinancialInfo>({});
  const [documents, setDocuments] = useState<ApplicationDocument[]>([]);
  const [personalStatement, setPersonalStatement] = useState('');

  // Fetch open programs
  const fetchPrograms = useCallback(async () => {
    setLoadingPrograms(true);
    try {
      const result = await browserGatewayFetch<{ data: ScholarshipProgramSummary[] }>(
        '/scholarships/programs?status=open&pageSize=50',
      );
      setPrograms(result.data);
    } catch {
      // Silently handle — user will see empty list
    } finally {
      setLoadingPrograms(false);
    }
  }, []);

  useEffect(() => {
    void fetchPrograms();
  }, [fetchPrograms]);

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);

  const goNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]!.key);
    }
  };

  const goBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]!.key);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await browserGatewayFetch<unknown>('/scholarships/applications', {
        method: 'POST',
        json: {
          programId: selectedProgramId,
          applicantId: '00000000-0000-4000-8000-000000000000', // Placeholder — resolved from auth context
          institutionId: '00000000-0000-4000-8000-000000000000', // Placeholder — resolved from auth context
          academicRecords: academicRecords.filter((r) => r.institutionName && r.educationLevel),
          financialInfo,
          documents,
          personalStatement: personalStatement || undefined,
        },
      });
      setSubmitSuccess(true);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to submit application. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Success state
  if (submitSuccess) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center space-y-4">
        <div className="text-4xl">🎉</div>
        <h1 className="text-2xl font-semibold">Application Submitted</h1>
        <p className="text-muted-foreground">
          Your scholarship application has been submitted and is now under review.
          You can track its status from the application status page.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Apply for Scholarship</h1>

      {/* Step indicator */}
      <nav aria-label="Application steps" className="flex gap-1">
        {STEPS.map((step, idx) => (
          <div
            key={step.key}
            className={`flex-1 h-1.5 rounded-full ${
              idx <= currentStepIndex ? 'bg-primary' : 'bg-muted'
            }`}
            aria-label={`${step.label}${idx <= currentStepIndex ? ' (completed)' : ''}`}
          />
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">
        Step {currentStepIndex + 1} of {STEPS.length}: {STEPS[currentStepIndex]!.label}
      </p>

      {/* Step content */}
      <div className="min-h-[300px]">
        {/* Step 1: Select Program */}
        {currentStep === 'program' && (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Select a Scholarship Program</h2>
            {loadingPrograms ? (
              <p className="text-muted-foreground text-sm">Loading available programs…</p>
            ) : programs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No open scholarship programs available.</p>
            ) : (
              <div className="space-y-3">
                {programs.map((program) => (
                  <label
                    key={program.id}
                    className={`block rounded-md border p-4 cursor-pointer transition-colors ${
                      selectedProgramId === program.id
                        ? 'border-primary bg-primary/5'
                        : 'border-input hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="program"
                      value={program.id}
                      checked={selectedProgramId === program.id}
                      onChange={(e) => setSelectedProgramId(e.target.value)}
                      className="sr-only"
                    />
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{program.name}</div>
                        {program.description && (
                          <div className="text-muted-foreground text-xs mt-1 line-clamp-2">
                            {program.description}
                          </div>
                        )}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>
                          {program.totalSlots - program.usedSlots} slots remaining
                        </div>
                        <div className="font-medium text-foreground">
                          {new Intl.NumberFormat(undefined, {
                            style: 'currency',
                            currency: program.currency,
                          }).format(program.amountPerRecipient)}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Academic Records */}
        {currentStep === 'academic' && (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Academic Records</h2>
            <p className="text-sm text-muted-foreground">
              Add your educational history. At least one record is required.
            </p>
            {academicRecords.map((record, idx) => (
              <fieldset key={idx} className="rounded-md border p-4 space-y-3">
                <legend className="text-sm font-medium px-1">Record {idx + 1}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Institution Name *</label>
                    <input
                      type="text"
                      value={record.institutionName}
                      onChange={(e) => {
                        const updated = [...academicRecords];
                        updated[idx] = { ...record, institutionName: e.target.value };
                        setAcademicRecords(updated);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Education Level *</label>
                    <input
                      type="text"
                      value={record.educationLevel}
                      onChange={(e) => {
                        const updated = [...academicRecords];
                        updated[idx] = { ...record, educationLevel: e.target.value };
                        setAcademicRecords(updated);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">GPA</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="4"
                      value={record.gpa ?? ''}
                      onChange={(e) => {
                        const updated = [...academicRecords];
                        updated[idx] = { ...record, gpa: e.target.value ? Number(e.target.value) : undefined };
                        setAcademicRecords(updated);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Year Completed</label>
                    <input
                      type="number"
                      min="1900"
                      max="2100"
                      value={record.yearCompleted ?? ''}
                      onChange={(e) => {
                        const updated = [...academicRecords];
                        updated[idx] = { ...record, yearCompleted: e.target.value ? Number(e.target.value) : undefined };
                        setAcademicRecords(updated);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                {academicRecords.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setAcademicRecords(academicRecords.filter((_, i) => i !== idx))}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove record
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() =>
                setAcademicRecords([
                  ...academicRecords,
                  { institutionName: '', educationLevel: '', gpa: undefined, yearCompleted: undefined, fieldOfStudy: '' },
                ])
              }
              className="text-sm text-primary hover:underline"
            >
              + Add another record
            </button>
          </div>
        )}

        {/* Step 3: Financial Information */}
        {currentStep === 'financial' && (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Financial Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Annual Family Income</label>
                <input
                  type="number"
                  min="0"
                  value={financialInfo.familyIncome ?? ''}
                  onChange={(e) =>
                    setFinancialInfo({
                      ...financialInfo,
                      familyIncome: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Number of Dependents</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={financialInfo.numberOfDependents ?? ''}
                  onChange={(e) =>
                    setFinancialInfo({
                      ...financialInfo,
                      numberOfDependents: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Employment Status</label>
                <select
                  value={financialInfo.employmentStatus ?? ''}
                  onChange={(e) =>
                    setFinancialInfo({
                      ...financialInfo,
                      employmentStatus: (e.target.value || undefined) as FinancialInfo['employmentStatus'],
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  <option value="student">Student</option>
                  <option value="employed">Employed</option>
                  <option value="unemployed">Unemployed</option>
                  <option value="self_employed">Self-Employed</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Documents */}
        {currentStep === 'documents' && (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Supporting Documents</h2>
            <p className="text-sm text-muted-foreground">
              Upload required documents such as transcripts, ID, and recommendation letters.
            </p>
            {documents.length > 0 && (
              <ul className="space-y-2">
                {documents.map((doc, idx) => (
                  <li key={idx} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div>
                      <span className="font-medium">{doc.documentType}</span>
                      <span className="text-muted-foreground ml-2">{doc.fileName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDocuments(documents.filter((_, i) => i !== idx))}
                      className="text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              <p>Document upload integration pending file storage wiring.</p>
              <p className="text-xs mt-1">
                Supported types: transcript, national_id, recommendation_letter, income_certificate
              </p>
            </div>
          </div>
        )}

        {/* Step 5: Review & Submit */}
        {currentStep === 'review' && (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Review Your Application</h2>
            <div className="rounded-md border divide-y text-sm">
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Selected Program</div>
                <div className="font-medium">
                  {programs.find((p) => p.id === selectedProgramId)?.name ?? 'None selected'}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Academic Records</div>
                <div>
                  {academicRecords
                    .filter((r) => r.institutionName)
                    .map((r, i) => (
                      <div key={i}>
                        {r.institutionName} — {r.educationLevel}
                        {r.gpa != null && ` (GPA: ${r.gpa})`}
                      </div>
                    ))}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Financial Info</div>
                <div>
                  {financialInfo.familyIncome != null && (
                    <span>Income: {financialInfo.familyIncome} </span>
                  )}
                  {financialInfo.employmentStatus && (
                    <span>Status: {financialInfo.employmentStatus.replace(/_/g, ' ')}</span>
                  )}
                  {!financialInfo.familyIncome && !financialInfo.employmentStatus && (
                    <span className="text-muted-foreground">Not provided</span>
                  )}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Documents</div>
                <div>{documents.length} document(s) attached</div>
              </div>
              {personalStatement && (
                <div className="p-4">
                  <div className="text-xs text-muted-foreground">Personal Statement</div>
                  <div className="line-clamp-3">{personalStatement}</div>
                </div>
              )}
            </div>

            {/* Personal statement */}
            <div>
              <label className="block text-xs font-medium mb-1">Personal Statement (optional)</label>
              <textarea
                value={personalStatement}
                onChange={(e) => setPersonalStatement(e.target.value)}
                maxLength={5000}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Why should you receive this scholarship?"
              />
              <div className="text-xs text-muted-foreground mt-1">
                {personalStatement.length}/5000 characters
              </div>
            </div>

            {submitError && (
              <div role="alert" className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
                {submitError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between pt-4 border-t">
        <button
          type="button"
          onClick={goBack}
          disabled={currentStepIndex === 0}
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
        >
          Back
        </button>
        {currentStep === 'review' ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !selectedProgramId}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Application'}
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            disabled={currentStep === 'program' && !selectedProgramId}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
