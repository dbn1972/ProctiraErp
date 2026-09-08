/**
 * Real PDF report-card generator (G-716).
 *
 * Renders `ReportCardData` into a spec-conformant PDF via `@proctira/pdf-lite`
 * (no native or third-party dependencies). Replaces the previous behaviour
 * where the assessment plugin ran without any `PdfGenerator` and jobs
 * completed with a URL that pointed at nothing.
 */
import { PdfDocument, PdfFlow } from '@proctira/pdf-lite';

import type { PdfGenerator, ReportCardData } from './report-card-service.js';

/** Strips HTML tags/entities from a template so its title can be reused as a heading. */
export function templateHeading(templateContent: string, fallback = 'Report Card'): string {
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(templateContent);
  const h1Match = /<h1[^>]*>([^<]*)<\/h1>/i.exec(templateContent);
  const candidate = (titleMatch?.[1] ?? h1Match?.[1] ?? '').trim();
  if (candidate && !candidate.includes('{{')) return candidate;
  const plain = templateContent
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain || plain.includes('{{') || plain.length > 60) return fallback;
  return plain;
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
}

export class ReportCardPdfGenerator implements PdfGenerator {
  async generateReportCardPdf(templateContent: string, data: ReportCardData): Promise<Buffer> {
    const institution = data.institution.name || 'Institution';
    const doc = new PdfDocument({
      title: `${templateHeading(templateContent)} - ${data.student.name || data.student.id}`,
      author: institution,
      creationDate: new Date(data.generatedAt),
    });
    const flow = new PdfFlow(doc, {
      header: institution,
      footer: `Generated ${data.generatedAt} - Page {page} of {pages}`,
    });

    flow.heading(templateHeading(templateContent), 18);
    if (data.institution.address) flow.paragraph(data.institution.address, { size: 9, grey: 0.35 });
    flow.spacer(6);

    flow.keyValue('Student', data.student.name || data.student.id);
    if (data.student.name) flow.keyValue('Student ID', data.student.id);
    flow.keyValue('Academic period', data.academicPeriodId);
    flow.horizontalRule();

    flow.subheading('Subject results');
    flow.table(
      [
        { header: 'Subject', weight: 3 },
        { header: 'Weighted avg', weight: 1.2, align: 'right' },
        { header: 'Grade', weight: 0.8 },
        { header: 'Descriptor', weight: 2 },
      ],
      data.subjects.map((s) => [
        s.subjectName || s.subjectId,
        fmt(s.weightedAverage),
        s.grade,
        s.gradeDescriptor ?? '',
      ]),
    );

    for (const subject of data.subjects) {
      if (subject.items.length === 0 && !subject.teacherComment) continue;
      flow.subheading(subject.subjectName || subject.subjectId);
      if (subject.items.length > 0) {
        flow.table(
          [
            { header: 'Assessment', weight: 3 },
            { header: 'Score', weight: 1, align: 'right' },
            { header: 'Max', weight: 1, align: 'right' },
            { header: 'Weight', weight: 1, align: 'right' },
            { header: 'Weighted', weight: 1, align: 'right' },
          ],
          subject.items.map((item) => [
            item.name || 'Assessment',
            fmt(item.score),
            item.maxScore > 0 ? fmt(item.maxScore, 0) : '-',
            `${fmt(item.weight * 100, 0)}%`,
            fmt(item.weightedScore, 2),
          ]),
        );
      }
      if (subject.teacherComment) {
        flow.paragraph(`Teacher comment: ${subject.teacherComment}`, { size: 9 });
        flow.spacer(4);
      }
    }

    flow.horizontalRule();
    flow.subheading('Overall summary');
    flow.keyValue('Average score', fmt(data.overallGradeSummary.averageScore));
    flow.keyValue('Subjects assessed', String(data.overallGradeSummary.totalSubjects));
    flow.keyValue('Overall grade', data.overallGradeSummary.grade);

    return flow.finish();
  }
}
