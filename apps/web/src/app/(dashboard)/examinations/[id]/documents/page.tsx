/**
 * Examination documents tab — admit cards, seating plans, certificates.
 *
 * Validates: Requirement 10.1 — generate and download examination documents.
 */
import { Download, FileText } from 'lucide-react';

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
import { listExaminationDocuments } from '@/lib/api/examinations';

interface PageProps {
  params: Promise<{ id: string }>;
}

const documentLabels: Record<string, string> = {
  ADMIT_CARD: 'Admit cards',
  SEATING_PLAN: 'Seating plan',
  CERTIFICATE: 'Certificates',
};

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
        <CardContent className="grid gap-4 md:grid-cols-3">
          {(['ADMIT_CARD', 'SEATING_PLAN', 'CERTIFICATE'] as const).map((type) => (
            <Button key={type} variant="outline" className="h-auto flex-col items-start py-4">
              <FileText className="mb-2 h-4 w-4" aria-hidden="true" />
              <span className="font-semibold">{documentLabels[type]}</span>
              <span className="text-xs text-muted-foreground">Generate &amp; download</span>
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generated documents</CardTitle>
          <CardDescription>
            {documents.length.toLocaleString()} files available for download.
          </CardDescription>
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
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-end">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{documentLabels[doc.type] ?? doc.type}</Badge>
                    </TableCell>
                    <TableCell>{doc.generatedAt}</TableCell>
                    <TableCell>{doc.format}</TableCell>
                    <TableCell className="text-end">
                      <Button asChild variant="ghost" size="sm">
                        <a href={doc.downloadUrl} download>
                          <Download className="me-1 h-4 w-4" aria-hidden="true" />
                          Download
                        </a>
                      </Button>
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
