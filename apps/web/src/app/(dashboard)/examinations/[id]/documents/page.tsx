/**
 * Examination documents tab — admit cards, seating plans, certificates.
 *
 * Validates: Requirement 10.1 — generate and download examination documents.
 * G-902: lists document jobs (GET /documents/jobs) and generates via Server
 * Action; completed jobs download through the authenticated proxy route.
 */
import { Download } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { GenerateDocumentButtons } from '@/components/examinations/exam-ops-controls';
import { listExaminationDocuments, type ExaminationDocument } from '@/lib/api/examinations';

interface PageProps {
  params: Promise<{ id: string }>;
}

const DOCUMENT_LABELS: Record<ExaminationDocument['documentType'], string> = {
  admit_card: 'Admit cards',
  seating_plan: 'Seating plan',
  result_certificate: 'Result certificates',
};

const STATUS_VARIANT: Record<
  ExaminationDocument['status'],
  'success' | 'warning' | 'destructive' | 'secondary'
> = {
  completed: 'success',
  processing: 'warning',
  queued: 'secondary',
  failed: 'destructive',
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function ExaminationDocumentsPage(props: PageProps) {
  const params = await props.params;
  const documents = await listExaminationDocuments(params.id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate documents</CardTitle>
          <CardDescription>
            Produce admit cards, seating plans, or certificates for this examination.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GenerateDocumentButtons examinationId={params.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generated documents</CardTitle>
          <CardDescription>{documents.length.toLocaleString()} generation jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No documents generated yet.
            </p>
          ) : (
            <Table aria-label="Documents">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Candidates</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">
                      {DOCUMENT_LABELS[doc.documentType] ?? doc.documentType}
                    </TableCell>
                    <TableCell>
                      {doc.processedCount} / {doc.totalCandidates}
                    </TableCell>
                    <TableCell>{formatDateTime(doc.completedAt ?? doc.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[doc.status]}>{doc.status}</Badge>
                      {doc.errorMessage && (
                        <span className="ms-2 text-xs text-destructive">{doc.errorMessage}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {doc.downloadPath ? (
                        <Button asChild variant="ghost" size="sm">
                          <a href={doc.downloadPath} download data-testid={`download-${doc.id}`}>
                            <Download className="me-1 h-4 w-4" aria-hidden="true" />
                            Download PDF
                          </a>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
