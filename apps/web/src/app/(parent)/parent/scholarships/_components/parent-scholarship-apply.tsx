'use client';

import { useEffect, useState } from 'react';

import { Button } from '@proctira/ui/components';

import { ApplicationDocumentsPanel } from '@/features/scholarships/components/application-documents-panel';
import { DocumentUploadSlots } from '@/features/scholarships/components/document-upload-slots';
import type { UploadedScholarshipDocument } from '@/features/scholarships/components/document-upload-slots';
import { missingRequiredDocuments } from '@/features/scholarships/document-upload';
import {
  BrowserGatewayError,
  scholarshipBrowserFetch,
} from '@/features/scholarships/scholarship-browser';

const API = '/api/parent-portal/scholarships';

interface OpenProgram {
  id: string;
  name: string;
  eligibility: { requiredDocuments: string[] };
}

interface OwnApplication {
  id: string;
  programId: string;
  applicantId: string;
  status: string;
}

export function ParentScholarshipApply({
  childrenLinks,
}: {
  childrenLinks: Array<{ studentId: string; label: string }>;
}) {
  const [childId, setChildId] = useState(childrenLinks[0]?.studentId ?? '');
  const [programs, setPrograms] = useState<OpenProgram[]>([]);
  const [programId, setProgramId] = useState('');
  const [applications, setApplications] = useState<OwnApplication[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedScholarshipDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    void scholarshipBrowserFetch<{ data: OpenProgram[] }>('/programs', { apiRoot: API })
      .then((result) => {
        setPrograms(result.data);
        setProgramId(result.data[0]?.id ?? '');
      })
      .catch((err: unknown) => {
        setError(err instanceof BrowserGatewayError ? err.message : 'Could not load programs');
      });
    void scholarshipBrowserFetch<{ data: OwnApplication[] }>('/applications', { apiRoot: API })
      .then((result) => setApplications(result.data))
      .catch((err: unknown) => {
        setError(err instanceof BrowserGatewayError ? err.message : 'Could not load applications');
      });
  }, []);

  const program = programs.find((item) => item.id === programId);
  const required = program?.eligibility.requiredDocuments ?? [];
  const own = applications.filter((row) => row.applicantId === childId);

  const startDraft = async () => {
    setError(null);
    setPending(true);
    try {
      const created = await scholarshipBrowserFetch<{ id: string }>('/applications', {
        method: 'POST',
        apiRoot: API,
        json: {
          programId,
          applicantId: childId,
          academicRecords: [
            { institutionName: 'Current school', educationLevel: 'secondary', gpa: 3 },
          ],
          financialInfo: { familyIncome: 0 },
          documents: [],
          asDraft: true,
        },
      });
      setDraftId(created.id);
      setUploaded([]);
    } catch (err) {
      setError(
        err instanceof BrowserGatewayError ? err.message : 'Could not start the application',
      );
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    if (!draftId) return;
    const missing = missingRequiredDocuments(
      required,
      uploaded.map((doc) => doc.documentType),
    );
    if (missing.length > 0) {
      setError(
        `Missing required documents: ${missing.join(', ')}. Upload each file before submitting.`,
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      await scholarshipBrowserFetch(`/applications/${draftId}/submit`, {
        method: 'POST',
        apiRoot: API,
        json: {},
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof BrowserGatewayError ? err.message : 'Could not submit');
    } finally {
      setPending(false);
    }
  };

  if (childrenLinks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Link a child before applying for a scholarship.
      </p>
    );
  }

  return (
    <div className="space-y-6" data-testid="parent-scholarships">
      <label className="block text-sm">
        Child
        <select
          className="mt-1 min-h-12 w-full rounded-md border px-3"
          value={childId}
          aria-label="Child"
          onChange={(event) => {
            setChildId(event.target.value);
            setDraftId(null);
          }}
        >
          {childrenLinks.map((child) => (
            <option key={child.studentId} value={child.studentId}>
              {child.label}
            </option>
          ))}
        </select>
      </label>

      <section aria-label="Your child's applications">
        <h2 className="text-base font-medium">Applications</h2>
        {own.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No applications for this child yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {own.map((row) => (
              <li
                key={row.id}
                className="rounded-md border p-3 text-sm"
                data-testid={`parent-application-${row.id}`}
              >
                <span className="font-medium">{row.status}</span>
                <ApplicationDocumentsPanel applicationId={row.id} canReview={false} apiRoot={API} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {submitted ? (
        <p role="status" className="text-sm">
          Application submitted.
        </p>
      ) : (
        <section aria-label="New scholarship application" className="space-y-3">
          <h2 className="text-base font-medium">Apply</h2>
          <label className="block text-sm">
            Program
            <select
              className="mt-1 min-h-12 w-full rounded-md border px-3"
              value={programId}
              aria-label="Scholarship program"
              onChange={(event) => setProgramId(event.target.value)}
            >
              {programs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {draftId ? (
            <>
              <DocumentUploadSlots
                applicationId={draftId}
                types={
                  required.length > 0 ? required : ['income_certificate', 'marksheet', 'id_proof']
                }
                requiredTypes={required}
                documents={uploaded}
                apiRoot={API}
                onUploaded={(doc) =>
                  setUploaded((rows) => [
                    ...rows.filter((row) => row.documentType !== doc.documentType),
                    doc,
                  ])
                }
                onRemoved={(id) => setUploaded((rows) => rows.filter((row) => row.id !== id))}
              />
              <Button
                type="button"
                className="min-h-12"
                disabled={pending}
                onClick={() => void submit()}
              >
                Submit application
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="min-h-12"
              disabled={pending || !programId}
              onClick={() => void startDraft()}
            >
              Start application
            </Button>
          )}
        </section>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
