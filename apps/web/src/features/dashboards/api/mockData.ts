/**
 * Mock dashboard payloads (Task 52.2).
 *
 * These mirror the shape that the live API contracts in design.md §G's
 * data-source table will return. They live in the feature folder so
 * task 60.3 can swap the data layer without touching dashboard pages —
 * only the hook bodies in `./queries.ts` need to be re-pointed at the
 * real client.
 *
 * The values are sourced from the prototype in
 * `School Platform Design/src/app/components/CountryDashboard.tsx`,
 * `StateDashboard.tsx`, and `BoardAdminDashboard.tsx` so the migrated
 * pages render the same numbers the design team approved.
 */

import type {
  BoardAdminDashboardData,
  BoardComparisonData,
  CountryDashboardData,
  CrossBoardTransferData,
  StateDashboardData,
} from './types';

export const COUNTRY_DASHBOARD_MOCK: CountryDashboardData = {
  kpis: [
    { id: 'schools', label: 'Schools', value: '248,456', delta: '+3.2%', direction: 'up' },
    { id: 'students', label: 'Students', value: '12.5M', delta: '+5.1%', direction: 'up' },
    { id: 'teachers', label: 'Teachers', value: '890,234', delta: '+2.8%', direction: 'up' },
    { id: 'attendance', label: 'Attendance', value: '87.3%', delta: '-0.8%', direction: 'down' },
    { id: 'pass-rate', label: 'Pass Rate', value: '72.1%', delta: '+1.2%', direction: 'up' },
    { id: 'gpi', label: 'GPI', value: '0.97', delta: 'stable', direction: 'flat' },
  ],
  boards: [
    {
      id: 'cbse',
      name: 'CBSE',
      schools: '28,456',
      students: '2.1M',
      attendance: '91.2%',
      passRate: '82.3%',
      ptr: '28:1',
    },
    {
      id: 'state',
      name: 'State Boards',
      schools: '185,000',
      students: '8.9M',
      attendance: '85.1%',
      passRate: '68.5%',
      ptr: '35:1',
    },
    {
      id: 'icse',
      name: 'ICSE',
      schools: '2,500',
      students: '450K',
      attendance: '94.5%',
      passRate: '89.1%',
      ptr: '22:1',
    },
    {
      id: 'ib',
      name: 'IB',
      schools: '200',
      students: '45K',
      attendance: '96.2%',
      passRate: '95.0%',
      ptr: '15:1',
    },
  ],
  enrollmentTrend: [
    { year: '2020-21', cbse: 1.8, state: 8.2, icse: 0.38, ib: 0.04 },
    { year: '2021-22', cbse: 1.9, state: 8.4, icse: 0.41, ib: 0.042 },
    { year: '2022-23', cbse: 2.0, state: 8.6, icse: 0.43, ib: 0.043 },
    { year: '2023-24', cbse: 2.05, state: 8.75, icse: 0.44, ib: 0.044 },
    { year: '2024-25', cbse: 2.1, state: 8.9, icse: 0.45, ib: 0.045 },
  ],
  states: [
    {
      id: 'MH',
      name: 'Maharashtra',
      schools: '45,000',
      students: '2.1M',
      attendance: '86.5%',
      passRate: '71.2%',
    },
    {
      id: 'KA',
      name: 'Karnataka',
      schools: '38,000',
      students: '1.8M',
      attendance: '88.1%',
      passRate: '73.5%',
    },
    {
      id: 'TN',
      name: 'Tamil Nadu',
      schools: '42,000',
      students: '1.9M',
      attendance: '89.2%',
      passRate: '75.8%',
    },
    {
      id: 'UP',
      name: 'Uttar Pradesh',
      schools: '52,000',
      students: '3.2M',
      attendance: '82.3%',
      passRate: '67.1%',
    },
    {
      id: 'GJ',
      name: 'Gujarat',
      schools: '35,000',
      students: '1.6M',
      attendance: '87.8%',
      passRate: '72.5%',
    },
  ],
};

export const STATE_DASHBOARD_MOCK: StateDashboardData = {
  stateName: 'Maharashtra',
  stateCode: 'MH',
  kpis: [
    { id: 'schools', label: 'Schools', value: '45,000', delta: '+2.8%', direction: 'up' },
    { id: 'students', label: 'Students', value: '2.1M', delta: '+4.9%', direction: 'up' },
    { id: 'teachers', label: 'Teachers', value: '134,000', delta: '+2.3%', direction: 'up' },
    { id: 'attendance', label: 'Attendance', value: '86.5%', delta: '-0.5%', direction: 'down' },
    { id: 'pass-rate', label: 'Pass Rate', value: '71.2%', delta: '+1.5%', direction: 'up' },
    { id: 'gpi', label: 'GPI', value: '0.95', delta: '+0.02', direction: 'up' },
  ],
  boards: [
    {
      id: 'cbse',
      name: 'CBSE',
      schools: '3,200',
      students: '245K',
      attendance: '91.0%',
      passRate: '81.5%',
      ptr: '27:1',
    },
    {
      id: 'msb',
      name: 'Maharashtra State Board',
      schools: '38,500',
      students: '1.7M',
      attendance: '84.8%',
      passRate: '67.2%',
      ptr: '36:1',
    },
    {
      id: 'icse',
      name: 'ICSE',
      schools: '890',
      students: '78K',
      attendance: '93.8%',
      passRate: '87.5%',
      ptr: '23:1',
    },
    {
      id: 'ib',
      name: 'IB',
      schools: '45',
      students: '8K',
      attendance: '95.5%',
      passRate: '93.2%',
      ptr: '16:1',
    },
  ],
  districtRanking: [
    { district: 'Pune', passRate: 76.5 },
    { district: 'Thane', passRate: 74.2 },
    { district: 'Kolhapur', passRate: 73.8 },
    { district: 'Mumbai', passRate: 72.8 },
    { district: 'Raigad', passRate: 71.5 },
    { district: 'Nashik', passRate: 70.5 },
    { district: 'Ahmednagar', passRate: 69.8 },
    { district: 'Nagpur', passRate: 69.1 },
    { district: 'Aurangabad', passRate: 68.5 },
    { district: 'Solapur', passRate: 67.2 },
  ],
  boardRadar: {
    axes: [
      { id: 'enrollment', label: 'Enrollment' },
      { id: 'attendance', label: 'Attendance' },
      { id: 'passRate', label: 'Pass Rate' },
      { id: 'ptr', label: 'PTR' },
      { id: 'gpi', label: 'GPI' },
    ],
    series: [
      {
        id: 'cbse',
        label: 'CBSE',
        values: { enrollment: 95, attendance: 91, passRate: 82, ptr: 75, gpi: 98 },
      },
      {
        id: 'state',
        label: 'State Board',
        values: { enrollment: 88, attendance: 85, passRate: 67, ptr: 55, gpi: 94 },
      },
      {
        id: 'icse',
        label: 'ICSE',
        values: { enrollment: 98, attendance: 94, passRate: 88, ptr: 85, gpi: 99 },
      },
      {
        id: 'ib',
        label: 'IB',
        values: { enrollment: 100, attendance: 96, passRate: 93, ptr: 95, gpi: 100 },
      },
    ],
  },
  districts: [
    {
      id: 'pune',
      name: 'Pune',
      schools: '4,500',
      students: '210K',
      attendance: '89.2%',
      passRate: '76.5%',
      boardMix: { cbse: 12, state: 85, icse: 3 },
    },
    {
      id: 'mumbai',
      name: 'Mumbai',
      schools: '6,200',
      students: '450K',
      attendance: '85.1%',
      passRate: '72.8%',
      boardMix: { cbse: 18, state: 78, icse: 4 },
    },
    {
      id: 'nagpur',
      name: 'Nagpur',
      schools: '3,100',
      students: '145K',
      attendance: '84.5%',
      passRate: '69.1%',
      boardMix: { cbse: 8, state: 90, icse: 2 },
    },
    {
      id: 'thane',
      name: 'Thane',
      schools: '3,800',
      students: '195K',
      attendance: '87.5%',
      passRate: '74.2%',
      boardMix: { cbse: 15, state: 82, icse: 3 },
    },
    {
      id: 'nashik',
      name: 'Nashik',
      schools: '2,900',
      students: '135K',
      attendance: '86.8%',
      passRate: '70.5%',
      boardMix: { cbse: 10, state: 88, icse: 2 },
    },
  ],
};

export const BOARD_ADMIN_DASHBOARD_MOCK: BoardAdminDashboardData = {
  boardName: 'CBSE Board Administration',
  boardCode: 'cbse',
  kpis: [
    {
      id: 'schools',
      label: 'CBSE Schools',
      value: '28,456',
      description: '+234 new affiliations',
      direction: 'up',
    },
    { id: 'students', label: 'Students', value: '2.1M', delta: '+5.2%', direction: 'up' },
    { id: 'teachers', label: 'Teachers', value: '145,000', delta: '+3.1%', direction: 'up' },
    {
      id: 'pass-rate',
      label: 'Board Exam Pass Rate',
      value: '82.3%',
      description: 'Class X + XII',
      direction: 'up',
    },
    { id: 'attendance', label: 'Avg Attendance', value: '91.2%', delta: '+0.8%', direction: 'up' },
    {
      id: 'expiring',
      label: 'Affiliations Expiring',
      value: '200',
      description: 'Action needed',
      direction: 'down',
    },
  ],
  regions: [
    {
      id: 'north',
      name: 'North',
      states: 'UP, Delhi, HR, PB, HP, JK',
      schools: '8,200',
      students: '620K',
      classXPass: '78.2%',
      classXIIPass: '80.1%',
    },
    {
      id: 'south',
      name: 'South',
      states: 'TN, KA, KL, AP, TS',
      schools: '6,100',
      students: '480K',
      classXPass: '85.1%',
      classXIIPass: '87.3%',
    },
    {
      id: 'east',
      name: 'East',
      states: 'WB, OR, JH, BH, AS',
      schools: '5,800',
      students: '410K',
      classXPass: '72.1%',
      classXIIPass: '74.5%',
    },
    {
      id: 'west',
      name: 'West',
      states: 'MH, GJ, RJ, GA, MP',
      schools: '5,400',
      students: '390K',
      classXPass: '80.3%',
      classXIIPass: '82.8%',
    },
  ],
  affiliations: [
    { status: 'active', count: 27800 },
    { status: 'provisional', count: 456 },
    { status: 'expiring', count: 200 },
  ],
  enrollmentGrowth: [
    { year: '2020-21', students: 1.8 },
    { year: '2021-22', students: 1.9 },
    { year: '2022-23', students: 2.0 },
    { year: '2023-24', students: 2.05 },
    { year: '2024-25', students: 2.1 },
  ],
  actionItems: [
    {
      id: 'expiring-200',
      title: '200 affiliations expiring in 6 months',
      description: 'Send renewal notices',
      priority: 'high',
      dueLabel: 'Within 6 months',
    },
    {
      id: 'provisional-456',
      title: 'Review 456 provisional affiliations',
      description: 'Schools pending final approval',
      priority: 'medium',
    },
    {
      id: 'inspections-12',
      title: '12 schools under inspection',
      description: 'Pending reports',
      priority: 'medium',
    },
    {
      id: 'classx-feb15',
      title: 'Board exam schedule: Class X starts Feb 15',
      description: 'Mark your calendar',
      priority: 'low',
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Board Comparison (Task 52.3 / Req 40.4)                              */
/* ------------------------------------------------------------------ */

/**
 * Sourced from the prototype at
 * `School Platform Design/src/app/components/BoardComparisonAnalytics.tsx`
 * — same numbers the design team approved. Real wiring ships in 60.3.
 */
export const BOARD_COMPARISON_MOCK: BoardComparisonData = {
  metrics: [
    { id: 'schools', label: 'Schools' },
    { id: 'students', label: 'Students' },
    { id: 'attendance', label: 'Attendance', unit: '%' },
    { id: 'passRate', label: 'Pass Rate', unit: '%' },
    { id: 'ptr', label: 'PTR' },
    { id: 'gpi', label: 'GPI' },
  ],
  boards: [
    {
      id: 'cbse',
      name: 'CBSE',
      kpis: {
        schools: '28,456',
        students: '2.1M',
        attendance: '91.2%',
        passRate: '82.3%',
        ptr: '28:1',
        gpi: '0.98',
      },
      radar: {
        schools: 75,
        students: 70,
        attendance: 91,
        passRate: 82,
        ptr: 72,
        gpi: 98,
      },
    },
    {
      id: 'state',
      name: 'State Boards',
      kpis: {
        schools: '185,000',
        students: '8.9M',
        attendance: '85.1%',
        passRate: '68.5%',
        ptr: '35:1',
        gpi: '0.94',
      },
      radar: {
        schools: 100,
        students: 100,
        attendance: 85,
        passRate: 68,
        ptr: 57,
        gpi: 94,
      },
    },
    {
      id: 'icse',
      name: 'ICSE',
      kpis: {
        schools: '2,500',
        students: '450K',
        attendance: '94.5%',
        passRate: '89.1%',
        ptr: '22:1',
        gpi: '0.99',
      },
      radar: {
        schools: 35,
        students: 30,
        attendance: 94,
        passRate: 89,
        ptr: 82,
        gpi: 99,
      },
    },
    {
      id: 'ib',
      name: 'IB',
      kpis: {
        schools: '200',
        students: '45K',
        attendance: '96.2%',
        passRate: '95.0%',
        ptr: '15:1',
        gpi: '1.00',
      },
      radar: {
        schools: 8,
        students: 5,
        attendance: 96,
        passRate: 95,
        ptr: 93,
        gpi: 100,
      },
    },
  ],
  trend: [
    {
      year: '2020-21',
      values: { cbse: 76.5, state: 62.1, icse: 84.2, ib: 91.5 },
    },
    {
      year: '2021-22',
      values: { cbse: 78.2, state: 64.3, icse: 85.8, ib: 92.8 },
    },
    {
      year: '2022-23',
      values: { cbse: 79.8, state: 66.1, icse: 87.2, ib: 93.5 },
    },
    {
      year: '2023-24',
      values: { cbse: 81.1, state: 67.5, icse: 88.4, ib: 94.2 },
    },
    {
      year: '2024-25',
      values: { cbse: 82.3, state: 68.5, icse: 89.1, ib: 95.0 },
    },
  ],
  detail: [
    // CBSE
    {
      id: 'cbse-passRate-2022-23',
      boardId: 'cbse',
      boardName: 'CBSE',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2022-23',
      value: '79.8%',
    },
    {
      id: 'cbse-passRate-2023-24',
      boardId: 'cbse',
      boardName: 'CBSE',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2023-24',
      value: '81.1%',
    },
    {
      id: 'cbse-passRate-2024-25',
      boardId: 'cbse',
      boardName: 'CBSE',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2024-25',
      value: '82.3%',
    },
    {
      id: 'cbse-attendance-2024-25',
      boardId: 'cbse',
      boardName: 'CBSE',
      metricId: 'attendance',
      metricLabel: 'Attendance',
      year: '2024-25',
      value: '91.2%',
    },
    {
      id: 'cbse-ptr-2024-25',
      boardId: 'cbse',
      boardName: 'CBSE',
      metricId: 'ptr',
      metricLabel: 'PTR',
      year: '2024-25',
      value: '28:1',
    },
    // State Boards
    {
      id: 'state-passRate-2022-23',
      boardId: 'state',
      boardName: 'State Boards',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2022-23',
      value: '66.1%',
    },
    {
      id: 'state-passRate-2023-24',
      boardId: 'state',
      boardName: 'State Boards',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2023-24',
      value: '67.5%',
    },
    {
      id: 'state-passRate-2024-25',
      boardId: 'state',
      boardName: 'State Boards',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2024-25',
      value: '68.5%',
    },
    {
      id: 'state-attendance-2024-25',
      boardId: 'state',
      boardName: 'State Boards',
      metricId: 'attendance',
      metricLabel: 'Attendance',
      year: '2024-25',
      value: '85.1%',
    },
    {
      id: 'state-ptr-2024-25',
      boardId: 'state',
      boardName: 'State Boards',
      metricId: 'ptr',
      metricLabel: 'PTR',
      year: '2024-25',
      value: '35:1',
    },
    // ICSE
    {
      id: 'icse-passRate-2022-23',
      boardId: 'icse',
      boardName: 'ICSE',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2022-23',
      value: '87.2%',
    },
    {
      id: 'icse-passRate-2023-24',
      boardId: 'icse',
      boardName: 'ICSE',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2023-24',
      value: '88.4%',
    },
    {
      id: 'icse-passRate-2024-25',
      boardId: 'icse',
      boardName: 'ICSE',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2024-25',
      value: '89.1%',
    },
    {
      id: 'icse-attendance-2024-25',
      boardId: 'icse',
      boardName: 'ICSE',
      metricId: 'attendance',
      metricLabel: 'Attendance',
      year: '2024-25',
      value: '94.5%',
    },
    {
      id: 'icse-ptr-2024-25',
      boardId: 'icse',
      boardName: 'ICSE',
      metricId: 'ptr',
      metricLabel: 'PTR',
      year: '2024-25',
      value: '22:1',
    },
    // IB
    {
      id: 'ib-passRate-2022-23',
      boardId: 'ib',
      boardName: 'IB',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2022-23',
      value: '93.5%',
    },
    {
      id: 'ib-passRate-2023-24',
      boardId: 'ib',
      boardName: 'IB',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2023-24',
      value: '94.2%',
    },
    {
      id: 'ib-passRate-2024-25',
      boardId: 'ib',
      boardName: 'IB',
      metricId: 'passRate',
      metricLabel: 'Pass Rate',
      year: '2024-25',
      value: '95.0%',
    },
    {
      id: 'ib-attendance-2024-25',
      boardId: 'ib',
      boardName: 'IB',
      metricId: 'attendance',
      metricLabel: 'Attendance',
      year: '2024-25',
      value: '96.2%',
    },
    {
      id: 'ib-ptr-2024-25',
      boardId: 'ib',
      boardName: 'IB',
      metricId: 'ptr',
      metricLabel: 'PTR',
      year: '2024-25',
      value: '15:1',
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Cross-Board Transfer (Task 52.3 / Req 40.5)                          */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the prototype at
 * `School Platform Design/src/app/components/CrossBoardTransfer.tsx`
 * collapsed onto the simplified happy-path state machine listed in the
 * task brief: Initiated → Documents Uploaded → Equivalency Mapped →
 * Source Approved → Destination Approved → Completed.
 *
 * The current step is `equivalency_mapped` (mid-flow) so the UI
 * exercises completed / current / pending visuals together. The
 * mocked `currentApprover` matches the active approval step so the
 * action buttons are enabled by default.
 */
export const CROSS_BOARD_TRANSFER_MOCK: CrossBoardTransferData = {
  transferId: 'TRN-2025-001234',
  studentName: 'Ahmed Hassan',
  studentId: 'STU-2024-001234',
  transferType: 'CROSS_BOARD_SAME_STATE',
  reason: 'Parent preference for CBSE curriculum',
  requestedAt: '2025-01-10',
  source: {
    id: 'msb-pune-001',
    name: 'Maharashtra State Board School, Pune',
    board: 'Maharashtra State Board',
    address: 'Karve Road, Pune, Maharashtra',
  },
  destination: {
    id: 'cbse-pune-002',
    name: 'CBSE Academy, Pune',
    board: 'CBSE',
    address: 'Baner Road, Pune, Maharashtra',
  },
  states: [
    { id: 'initiated', label: 'Initiated', description: 'Transfer request received' },
    {
      id: 'documents_uploaded',
      label: 'Documents Uploaded',
      description: 'Required documents on file',
    },
    {
      id: 'equivalency_mapped',
      label: 'Equivalency Mapped',
      description: 'Curriculum mapping verified',
    },
    {
      id: 'source_approved',
      label: 'Source Approved',
      description: 'Source institution approval',
    },
    {
      id: 'destination_approved',
      label: 'Destination Approved',
      description: 'Destination institution approval',
    },
    { id: 'completed', label: 'Completed', description: 'Transfer finalised' },
  ],
  currentStateId: 'equivalency_mapped',
  completedStateIds: ['initiated', 'documents_uploaded'],
  approvals: [
    {
      id: 'parent-init',
      name: 'Initiated by Parent',
      approver: 'Mrs. Hassan',
      status: 'completed',
      updatedAt: '10 Jan 2025, 9:00 AM',
    },
    {
      id: 'source-principal',
      name: 'Source Principal Review',
      approver: 'Mr. Patil',
      status: 'completed',
      updatedAt: '11 Jan 2025',
    },
    {
      id: 'source-board',
      name: 'Source Board Officer',
      approver: 'MH Board Office',
      status: 'completed',
      updatedAt: '13 Jan 2025',
    },
    {
      id: 'equivalency',
      name: 'Equivalency Check',
      approver: 'AUTO-VALIDATED',
      status: 'current',
      updatedAt: '13 Jan 2025',
      note: 'Credit mapping verified. Bridge exam flagged for Marathi → Hindi.',
    },
    {
      id: 'destination-board',
      name: 'Destination Board Officer',
      approver: 'CBSE Regional Office',
      status: 'pending',
    },
    {
      id: 'destination-principal',
      name: 'Destination Principal',
      approver: 'Pending assignment',
      status: 'pending',
    },
  ],
  equivalency: [
    {
      id: 'eq-math',
      sourceSubject: 'Mathematics (Marathi medium)',
      destinationSubject: 'Mathematics',
      status: 'mapped',
    },
    {
      id: 'eq-science',
      sourceSubject: 'Science & Technology',
      destinationSubject: 'Science',
      status: 'mapped',
    },
    {
      id: 'eq-english',
      sourceSubject: 'English',
      destinationSubject: 'English',
      status: 'mapped',
    },
    {
      id: 'eq-social',
      sourceSubject: 'Social Science',
      destinationSubject: 'Social Science',
      status: 'mapped',
    },
    {
      id: 'eq-marathi',
      sourceSubject: 'Marathi (First Language)',
      destinationSubject: 'Hindi / Sanskrit',
      status: 'bridge',
    },
    {
      id: 'eq-hindi',
      sourceSubject: 'Hindi (Second Language)',
      destinationSubject: '—',
      status: 'na',
    },
  ],
  documents: [
    { id: 'doc-tc', name: 'Transfer Certificate (State Board)', uploaded: true },
    { id: 'doc-marks', name: 'Mark Sheet (Class 8)', uploaded: true },
    { id: 'doc-character', name: 'Character Certificate', uploaded: true },
    { id: 'doc-cbse-form', name: 'CBSE Admission Form', uploaded: false },
  ],
  currentApprover: 'equivalency',
};
