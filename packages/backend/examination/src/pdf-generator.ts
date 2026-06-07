/**
 * PDF Generator
 *
 * Generates PDF documents for examination admit cards, seating plans,
 * and result certificates. Uses a simple buffer-based approach that
 * can be backed by PDFKit or any other PDF library.
 *
 * Requirements:
 * - 10.6: Generate examination documents as PDF files
 */
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
 * Simple PDF generator implementation that creates structured text-based PDFs.
 * In production, this would use PDFKit or a similar library for proper formatting.
 * For now, it generates a structured buffer representing the PDF content.
 */
export class SimplePdfGenerator implements PdfGenerator {
  /**
   * Generate admit cards for a batch of candidates.
   * Each admit card contains: candidate name, roll number, center, subjects, schedule.
   */
  async generateAdmitCards(
    examination: ExaminationInfo,
    candidates: DocumentCandidate[],
  ): Promise<Buffer> {
    const pages: string[] = [];

    for (const candidate of candidates) {
      const page = [
        '--- ADMIT CARD ---',
        `Examination: ${examination.name} (${examination.code})`,
        `Date: ${examination.startDate} to ${examination.endDate}`,
        '',
        `Candidate Name: ${candidate.studentName}`,
        `Roll Number: ${candidate.rollNumber}`,
        `Center: ${candidate.centerName}`,
        `Subjects: ${candidate.subjectNames.join(', ')}`,
        '',
        'Schedule:',
        ...examination.sessions
          .filter((s) => candidate.subjectNames.includes(s.subjectName))
          .map((s) => `  ${s.subjectName}: ${s.date} ${s.startTime}-${s.endTime}`),
        '',
        'Instructions:',
        '  1. Arrive 30 minutes before the examination starts.',
        '  2. Bring this admit card and a valid photo ID.',
        '  3. Electronic devices are not permitted in the examination hall.',
        '',
        '--- END ---',
        '\f', // page break
      ].join('\n');

      pages.push(page);
    }

    return Buffer.from(pages.join(''), 'utf-8');
  }

  /**
   * Generate a seating plan for a center.
   * Contains: center name, room assignments, candidate-seat mapping.
   */
  async generateSeatingPlan(
    examination: ExaminationInfo,
    assignments: SeatingAssignment[],
  ): Promise<Buffer> {
    // Group assignments by center and room
    const byCenter = new Map<string, Map<string, SeatingAssignment[]>>();

    for (const assignment of assignments) {
      if (!byCenter.has(assignment.centerName)) {
        byCenter.set(assignment.centerName, new Map());
      }
      const rooms = byCenter.get(assignment.centerName)!;
      if (!rooms.has(assignment.roomNumber)) {
        rooms.set(assignment.roomNumber, []);
      }
      rooms.get(assignment.roomNumber)!.push(assignment);
    }

    const pages: string[] = [];

    for (const [centerName, rooms] of byCenter) {
      const page = [
        '--- SEATING PLAN ---',
        `Examination: ${examination.name} (${examination.code})`,
        `Center: ${centerName}`,
        `Date: ${examination.startDate} to ${examination.endDate}`,
        '',
      ];

      for (const [roomNumber, roomAssignments] of rooms) {
        page.push(`Room: ${roomNumber}`);
        page.push('-'.repeat(60));
        page.push('Seat No. | Roll Number | Candidate Name | Subjects');
        page.push('-'.repeat(60));

        for (const assignment of roomAssignments.sort((a, b) => a.seatNumber.localeCompare(b.seatNumber))) {
          page.push(
            `${assignment.seatNumber.padEnd(9)}| ${assignment.rollNumber.padEnd(12)}| ${assignment.studentName.padEnd(15)}| ${assignment.subjectNames.join(', ')}`,
          );
        }

        page.push('-'.repeat(60));
        page.push(`Total Candidates: ${roomAssignments.length}`);
        page.push('');
      }

      page.push('--- END ---');
      page.push('\f');
      pages.push(page.join('\n'));
    }

    return Buffer.from(pages.join(''), 'utf-8');
  }

  /**
   * Generate result certificates for a batch of candidates.
   * Contains: candidate name, subjects with scores/grades, overall result.
   */
  async generateResultCertificates(
    examination: ExaminationInfo,
    results: CandidateResultData[],
  ): Promise<Buffer> {
    const pages: string[] = [];

    for (const result of results) {
      const page = [
        '--- RESULT CERTIFICATE ---',
        `Examination: ${examination.name} (${examination.code})`,
        '',
        `Candidate Name: ${result.studentName}`,
        `Roll Number: ${result.rollNumber}`,
        '',
        'Subject Results:',
        '-'.repeat(50),
        'Subject | Score | Grade | Status',
        '-'.repeat(50),
      ];

      for (const subject of result.subjects) {
        const status = subject.passed ? 'PASS' : 'FAIL';
        page.push(
          `${subject.name.padEnd(8)}| ${String(subject.score).padEnd(6)}| ${subject.grade.padEnd(6)}| ${status}`,
        );
      }

      page.push('-'.repeat(50));
      page.push('');
      page.push(`Total Score: ${result.totalScore} / ${result.maxPossibleScore}`);
      page.push(`Overall Grade: ${result.overallGrade}`);
      page.push(`Overall Result: ${result.overallPassed ? 'PASSED' : 'FAILED'}`);
      page.push('');
      page.push('This is a computer-generated certificate.');
      page.push('--- END ---');
      page.push('\f');

      pages.push(page.join('\n'));
    }

    return Buffer.from(pages.join(''), 'utf-8');
  }
}
