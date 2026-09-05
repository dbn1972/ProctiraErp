/**
 * Demo seed + UI aggregate payloads for Health redesign screens.
 *
 * The App Router client expects:
 *   GET /health/records
 *   GET /health/records/:studentId
 *   GET /health/special-needs
 *   GET /health/counselling
 *   GET /health/screening-programs
 *
 * Domain CRUD lives under resource-scoped paths; these aggregates power the
 * redesign lists until Prisma health models land.
 */

export const HEALTH_DEMO_TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

export const HEALTH_STUDENT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const HEALTH_STUDENT_B_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const HEALTH_SCREENING_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

export interface UiHealthRecord {
  id: string;
  studentId: string;
  studentName: string;
  bloodType?: string | null;
  allergies?: string[];
  chronicConditions?: string[];
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  lastUpdated: string;
}

export interface UiSpecialNeedRecord {
  id: string;
  studentId: string;
  studentName: string;
  category: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  accommodations: string[];
  iepActive: boolean;
}

export interface UiCounsellingSession {
  id: string;
  studentId: string;
  studentName: string;
  counsellorName: string;
  sessionDate: string;
  topic: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
}

export interface UiScreeningProgram {
  id: string;
  name: string;
  description?: string | null;
  gradeLevel: string;
  assessmentTypes: string[];
  scheduledDate?: string | null;
  status: string;
}

export interface HealthUiSeed {
  records: UiHealthRecord[];
  specialNeeds: UiSpecialNeedRecord[];
  counselling: UiCounsellingSession[];
  screenings: UiScreeningProgram[];
}

export function createHealthUiSeed(): HealthUiSeed {
  return {
    records: [
      {
        id: HEALTH_STUDENT_A_ID,
        studentId: HEALTH_STUDENT_A_ID,
        studentName: 'Aisha Rahman',
        bloodType: 'B+',
        allergies: ['Peanuts', 'Penicillin'],
        chronicConditions: ['Asthma'],
        emergencyContactName: 'Farah Rahman',
        emergencyContactPhone: '+91 98765 01001',
        lastUpdated: '2026-09-01',
      },
      {
        id: HEALTH_STUDENT_B_ID,
        studentId: HEALTH_STUDENT_B_ID,
        studentName: 'Rohan Mehta',
        bloodType: 'O+',
        allergies: [],
        chronicConditions: ['Type 1 Diabetes'],
        emergencyContactName: 'Neha Mehta',
        emergencyContactPhone: '+91 98765 01002',
        lastUpdated: '2026-09-03',
      },
    ],
    specialNeeds: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        studentId: HEALTH_STUDENT_A_ID,
        studentName: 'Aisha Rahman',
        category: 'Learning support',
        severity: 'MODERATE',
        accommodations: ['Extra time on exams', 'Preferential seating'],
        iepActive: true,
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        studentId: HEALTH_STUDENT_B_ID,
        studentName: 'Rohan Mehta',
        category: 'Medical',
        severity: 'MILD',
        accommodations: ['Glucose monitoring breaks'],
        iepActive: false,
      },
    ],
    counselling: [
      {
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        studentId: HEALTH_STUDENT_A_ID,
        studentName: 'Aisha Rahman',
        counsellorName: 'Dr. Priya Nair',
        sessionDate: '2026-09-04',
        topic: 'Exam anxiety coping plan',
        status: 'COMPLETED',
      },
      {
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
        studentId: HEALTH_STUDENT_B_ID,
        studentName: 'Rohan Mehta',
        counsellorName: 'Dr. Priya Nair',
        sessionDate: '2026-09-08',
        topic: 'Peer support check-in',
        status: 'SCHEDULED',
      },
    ],
    screenings: [
      {
        id: HEALTH_SCREENING_ID,
        name: 'Annual Grade 8 Vision & Hearing',
        description: 'School-wide screening for Grade 8 students.',
        gradeLevel: '8',
        assessmentTypes: ['vision', 'hearing'],
        scheduledDate: '2026-09-15',
        status: 'planned',
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        name: 'Dental Screening — Primary',
        description: 'Dental check for Grades 1–5.',
        gradeLevel: '1-5',
        assessmentTypes: ['dental'],
        scheduledDate: '2026-10-01',
        status: 'in-progress',
      },
    ],
  };
}
