/**
 * WS4 multi-board compliance export pack registry.
 *
 * Field maps and required subjects for CBSE, ICSE, and MH-STATE.
 * Packs are versioned so golden fixtures can pin a revision.
 */

export type BoardPackCode = 'CBSE' | 'ICSE' | 'MH-STATE';

export type BoardPackField = {
  /** Internal source key */
  source: string;
  /** Board-facing column / JSON key */
  exportKey: string;
  /** Human label for UI / PDF-lite */
  label: string;
  required: boolean;
};

export type BoardPackDefinition = {
  code: BoardPackCode;
  name: string;
  version: string;
  /** Subject assessment codes that must be present for every candidate */
  requiredSubjects: readonly string[];
  /** Optional electives — missing does not block export */
  optionalSubjects: readonly string[];
  marksheetFields: readonly BoardPackField[];
  examResultFields: readonly BoardPackField[];
  terminology: {
    studentId: string;
    schoolCode: string;
    centreCode: string;
    marks: string;
    grade: string;
    result: string;
  };
  securityMark: string;
};

export const BOARD_PACKS: Record<BoardPackCode, BoardPackDefinition> = {
  CBSE: {
    code: 'CBSE',
    name: 'CBSE marksheet & exam results pack',
    version: '2026.1',
    requiredSubjects: ['ENG', 'MATH', 'SCI', 'SST'],
    optionalSubjects: ['LANG2', 'IT'],
    marksheetFields: [
      { source: 'nationalId', exportKey: 'roll_no', label: 'Roll No', required: true },
      {
        source: 'studentName',
        exportKey: 'candidate_name',
        label: 'Candidate Name',
        required: true,
      },
      {
        source: 'affiliationCode',
        exportKey: 'affiliation_no',
        label: 'Affiliation No',
        required: true,
      },
      { source: 'centreCode', exportKey: 'centre_no', label: 'Centre No', required: true },
      {
        source: 'subjectMarks',
        exportKey: 'subject_marks',
        label: 'Subject Marks',
        required: true,
      },
      {
        source: 'subjectGrades',
        exportKey: 'subject_grades',
        label: 'Subject Grades',
        required: true,
      },
      { source: 'result', exportKey: 'result', label: 'Result', required: true },
    ],
    examResultFields: [
      { source: 'nationalId', exportKey: 'roll_no', label: 'Roll No', required: true },
      { source: 'centreCode', exportKey: 'centre_no', label: 'Centre No', required: true },
      { source: 'subjectCode', exportKey: 'subject_code', label: 'Subject Code', required: true },
      {
        source: 'marksObtained',
        exportKey: 'marks_obtained',
        label: 'Marks Obtained',
        required: true,
      },
      { source: 'grade', exportKey: 'grade', label: 'Grade', required: true },
    ],
    terminology: {
      studentId: 'Roll No',
      schoolCode: 'Affiliation No',
      centreCode: 'Centre No',
      marks: 'Marks Obtained',
      grade: 'Grade',
      result: 'Result',
    },
    securityMark: 'CBSE-OFFICIAL-PACK-v2026.1',
  },
  ICSE: {
    code: 'ICSE',
    name: 'ICSE marksheet & exam results pack',
    version: '2026.1',
    requiredSubjects: ['ENG', 'MATH', 'SCI', 'HIST'],
    optionalSubjects: ['GEO', 'COMP'],
    marksheetFields: [
      { source: 'nationalId', exportKey: 'unique_id', label: 'Unique ID', required: true },
      {
        source: 'studentName',
        exportKey: 'candidate_name',
        label: 'Candidate Name',
        required: true,
      },
      { source: 'affiliationCode', exportKey: 'school_code', label: 'School Code', required: true },
      { source: 'centreCode', exportKey: 'centre_code', label: 'Centre Code', required: true },
      { source: 'subjectMarks', exportKey: 'papers', label: 'Paper Marks', required: true },
      { source: 'subjectGrades', exportKey: 'grades', label: 'Grades', required: true },
      { source: 'result', exportKey: 'pass_fail', label: 'Pass/Fail', required: true },
    ],
    examResultFields: [
      { source: 'nationalId', exportKey: 'unique_id', label: 'Unique ID', required: true },
      { source: 'centreCode', exportKey: 'centre_code', label: 'Centre Code', required: true },
      { source: 'subjectCode', exportKey: 'paper_code', label: 'Paper Code', required: true },
      { source: 'marksObtained', exportKey: 'marks', label: 'Marks', required: true },
      { source: 'grade', exportKey: 'grade', label: 'Grade', required: true },
    ],
    terminology: {
      studentId: 'Unique ID',
      schoolCode: 'School Code',
      centreCode: 'Centre Code',
      marks: 'Marks',
      grade: 'Grade',
      result: 'Pass/Fail',
    },
    securityMark: 'CISCE-ICSE-PACK-v2026.1',
  },
  'MH-STATE': {
    code: 'MH-STATE',
    name: 'Maharashtra State Board marksheet & exam results pack',
    version: '2026.1',
    requiredSubjects: ['ENG', 'MATH', 'SCI', 'SOC'],
    optionalSubjects: ['MAR', 'IT'],
    marksheetFields: [
      { source: 'nationalId', exportKey: 'seat_no', label: 'Seat No', required: true },
      { source: 'studentName', exportKey: 'student_name', label: 'Student Name', required: true },
      {
        source: 'affiliationCode',
        exportKey: 'school_index',
        label: 'School Index',
        required: true,
      },
      { source: 'centreCode', exportKey: 'centre_code', label: 'Centre Code', required: true },
      {
        source: 'subjectMarks',
        exportKey: 'subject_marks',
        label: 'Subject Marks',
        required: true,
      },
      {
        source: 'subjectGrades',
        exportKey: 'class_awarded',
        label: 'Class Awarded',
        required: true,
      },
      { source: 'result', exportKey: 'result', label: 'Result', required: true },
    ],
    examResultFields: [
      { source: 'nationalId', exportKey: 'seat_no', label: 'Seat No', required: true },
      { source: 'centreCode', exportKey: 'centre_code', label: 'Centre Code', required: true },
      { source: 'subjectCode', exportKey: 'subject_code', label: 'Subject Code', required: true },
      { source: 'marksObtained', exportKey: 'marks', label: 'Marks', required: true },
      { source: 'grade', exportKey: 'class', label: 'Class', required: true },
    ],
    terminology: {
      studentId: 'Seat No',
      schoolCode: 'School Index',
      centreCode: 'Centre Code',
      marks: 'Marks',
      grade: 'Class',
      result: 'Result',
    },
    securityMark: 'MSBSHSE-MH-PACK-v2026.1',
  },
};

export function listBoardPacks(): BoardPackDefinition[] {
  return Object.values(BOARD_PACKS);
}

export function getBoardPack(code: string): BoardPackDefinition | null {
  const key = code.toUpperCase() as BoardPackCode;
  return BOARD_PACKS[key] ?? null;
}

export function isBoardPackCode(code: string): code is BoardPackCode {
  return code.toUpperCase() in BOARD_PACKS;
}
