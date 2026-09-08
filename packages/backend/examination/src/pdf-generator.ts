/**
 * PDF Generator
 *
 * Generates real PDF documents for examination admit cards, seating plans,
 * and result certificates via the dependency-free `@proctira/pdf-lite`
 * writer (G-716). `PdfGenerator` remains an interface so a richer renderer
 * can be swapped in without touching the document service.
 *
 * Requirements:
 * - 10.6: Generate examination documents as PDF files
 */
import { PdfDocument, PdfFlow } from '@proctira/pdf-lite';

import type {
  DocumentCandidate,
  SeatingAssignment,
  CandidateResultData,
} from './document-repository.js';

/**
 * Examination metadata used in document headers.
 */
export interface ExaminationInfo {
  id: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  sessions: Array<{
    subjectName: string;
    date: string;
    startTime: string;
    endTime: string;
  }>;
}

/**
 * Interface for PDF generation.
 * Implementations can use PDFKit, Puppeteer, or any other PDF library.
 */
export interface PdfGenerator {
  /** Generate admit cards for a batch of candidates */
  generateAdmitCards(
    examination: ExaminationInfo,
    candidates: DocumentCandidate[],
  ): Promise<Buffer>;

  /** Generate a seating plan for a center */
  generateSeatingPlan(
    examination: ExaminationInfo,
    assignments: SeatingAssignment[],
  ): Promise<Buffer>;

  /** Generate result certificates for a batch of candidates */
  generateResultCertificates(
    examination: ExaminationInfo,
    results: CandidateResultData[],
  ): Promise<Buffer>;
}

/**
 * PDF generator backed by `@proctira/pdf-lite`. One page per admit card /
 * certificate, one page per examination centre for seating plans.
 */
export class SimplePdfGenerator implements PdfGenerator {
  private newFlow(examination: ExaminationInfo, title: string): PdfFlow {
    const doc = new PdfDocument({
      title: `${title} - ${examination.name}`,
      author: 'ProctiraERP Examinations',
    });
    return new PdfFlow(doc, {
      header: `${examination.name} (${examination.code})`,
      footer: `${title} - Page {page} of {pages}`,
    });
  }

  /**
   * Generate admit cards for a batch of candidates.
   * Each admit card contains: candidate name, roll number, center, subjects, schedule.
   */
  async generateAdmitCards(
    examination: ExaminationInfo,
    candidates: DocumentCandidate[],
  ): Promise<Buffer> {
    const flow = this.newFlow(examination, 'Admit Card');
    candidates.forEach((candidate, index) => {
      if (index > 0) flow.newPage();
      flow.heading('ADMIT CARD', 18);
      flow.keyValue('Examination', `${examination.name} (${examination.code})`);
      flow.keyValue('Dates', `${examination.startDate} to ${examination.endDate}`);
      flow.spacer(4);
      flow.keyValue('Candidate Name', candidate.studentName);
      flow.keyValue('Roll Number', candidate.rollNumber);
      flow.keyValue('Center', candidate.centerName);
      flow.keyValue('Subjects', candidate.subjectNames.join(', '));
      flow.horizontalRule();
      flow.subheading('Schedule');
      flow.table(
        [
          { header: 'Subject', weight: 2 },
          { header: 'Date', weight: 1 },
          { header: 'Time', weight: 1 },
        ],
        examination.sessions
          .filter((s) => candidate.subjectNames.includes(s.subjectName))
          .map((s) => [s.subjectName, s.date, `${s.startTime}-${s.endTime}`]),
      );
      flow.subheading('Instructions');
      flow.paragraph('1. Arrive 30 minutes before the examination starts.');
      flow.paragraph('2. Bring this admit card and a valid photo ID.');
      flow.paragraph('3. Electronic devices are not permitted in the examination hall.');
    });
    return flow.finish();
  }

  /**
   * Generate a seating plan for a center.
   * Contains: center name, room assignments, candidate-seat mapping.
   */
  async generateSeatingPlan(
    examination: ExaminationInfo,
    assignments: SeatingAssignment[],
  ): Promise<Buffer> {
    const byCenter = new Map<string, Map<string, SeatingAssignment[]>>();
    for (const assignment of assignments) {
      if (!byCenter.has(assignment.centerName)) byCenter.set(assignment.centerName, new Map());
      const rooms = byCenter.get(assignment.centerName)!;
      if (!rooms.has(assignment.roomNumber)) rooms.set(assignment.roomNumber, []);
      rooms.get(assignment.roomNumber)!.push(assignment);
    }

    const flow = this.newFlow(examination, 'Seating Plan');
    let first = true;
    for (const [centerName, rooms] of byCenter) {
      if (!first) flow.newPage();
      first = false;
      flow.heading('SEATING PLAN', 18);
      flow.keyValue('Examination', `${examination.name} (${examination.code})`);
      flow.keyValue('Center', centerName);
      flow.keyValue('Dates', `${examination.startDate} to ${examination.endDate}`);
      for (const [roomNumber, roomAssignments] of rooms) {
        flow.subheading(`Room ${roomNumber}`);
        flow.table(
          [
            { header: 'Seat No.', weight: 1 },
            { header: 'Roll Number', weight: 1.4 },
            { header: 'Candidate Name', weight: 2.2 },
            { header: 'Subjects', weight: 2.4 },
          ],
          roomAssignments
            .slice()
            .sort((a, b) => a.seatNumber.localeCompare(b.seatNumber))
            .map((a) => [a.seatNumber, a.rollNumber, a.studentName, a.subjectNames.join(', ')]),
        );
        flow.paragraph(`Total Candidates: ${roomAssignments.length}`, { size: 9 });
      }
    }
    return flow.finish();
  }

  /**
   * Generate result certificates for a batch of candidates.
   * Contains: candidate name, subjects with scores/grades, overall result.
   */
  async generateResultCertificates(
    examination: ExaminationInfo,
    results: CandidateResultData[],
  ): Promise<Buffer> {
    const flow = this.newFlow(examination, 'Result Certificate');
    results.forEach((result, index) => {
      if (index > 0) flow.newPage();
      flow.heading('RESULT CERTIFICATE', 18);
      flow.keyValue('Examination', `${examination.name} (${examination.code})`);
      flow.keyValue('Candidate Name', result.studentName);
      flow.keyValue('Roll Number', result.rollNumber);
      flow.horizontalRule();
      flow.subheading('Subject Results');
      flow.table(
        [
          { header: 'Subject', weight: 2.5 },
          { header: 'Score', weight: 1, align: 'right' },
          { header: 'Grade', weight: 1 },
          { header: 'Status', weight: 1 },
        ],
        result.subjects.map((s) => [s.name, String(s.score), s.grade, s.passed ? 'PASS' : 'FAIL']),
      );
      flow.keyValue('Total Score', `${result.totalScore} / ${result.maxPossibleScore}`);
      flow.keyValue('Overall Grade', result.overallGrade);
      flow.keyValue('Overall Result', result.overallPassed ? 'PASSED' : 'FAILED');
      flow.spacer(8);
      flow.paragraph('This is a computer-generated certificate.', { size: 8, grey: 0.4 });
    });
    return flow.finish();
  }
}
