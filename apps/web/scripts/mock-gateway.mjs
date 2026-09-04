/**
 * Mock API gateway for screenshot capture.
 *
 * Stands in for the real api-gateway + backend microservices so the web app
 * renders with realistic data instead of empty/error states. Returns
 * tenant-shaped JSON for /api/v1/* : list endpoints as { data, meta }, detail
 * endpoints as the entity. Permissive CORS + accepts any bearer token.
 *
 *   node scripts/mock-gateway.mjs            # listens on :3000
 *
 * Point the web app at it with NEXT_PUBLIC_GATEWAY_URL=http://localhost:3000.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);

// Fixed ids so dynamic [id] pages can be captured with known values.
export const FIXED_ID = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const id3 = '33333333-3333-4333-8333-333333333333';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FIRST = ['Aarav', 'Diya', 'Vivaan', 'Ananya', 'Aditya', 'Ishaan', 'Saanvi', 'Kabir'];
const LAST = ['Sharma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Khan', 'Das', 'Gupta'];
const ISO = '2025-06-01T09:30:00.000Z';
const DOB = '2012-04-18';

const pick = (arr, i) => arr[i % arr.length];

function meta(total) {
  return { page: 1, pageSize: 20, totalItems: total, totalPages: 1, total, totalCount: total };
}

function person(i) {
  const firstName = pick(FIRST, i);
  const lastName = pick(LAST, i);
  return {
    id: i === 0 ? FIXED_ID : `${FIXED_ID.slice(0, -3)}${String(100 + i).slice(-3)}`,
    tenantId: TENANT,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    name: `${firstName} ${lastName}`,
    displayName: `${firstName} ${lastName}`,
    gender: i % 2 ? 'M' : 'F',
    dateOfBirth: DOB,
    nationalId: `IDN${10000 + i}`,
    nationality: 'IN',
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@school.edu`,
    phone: `+91 98${String(10000000 + i * 7).slice(0, 8)}`,
    status: 'ACTIVE',
    contacts: [{ type: 'phone', value: `+91 98${String(10000000 + i).slice(0, 8)}`, isPrimary: true }],
    guardians: [
      { id: id2, firstName: 'Rohan', lastName, relationship: 'Father', contactPhone: '+91 9800000000', contactEmail: 'guardian@school.edu' },
    ],
    identityDocuments: [{ type: 'Aadhaar', number: `XXXX-XXXX-${1000 + i}`, issuingCountry: 'IN' }],
    customData: {},
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function institution(i) {
  return {
    id: i === 0 ? FIXED_ID : `${FIXED_ID.slice(0, -3)}${String(200 + i).slice(-3)}`,
    tenantId: TENANT,
    code: `SCH-${1000 + i}`,
    name: `${pick(['Delhi', 'Mumbai', 'Chennai', 'Pune', 'Kochi'], i)} Public School`,
    status: 'ACTIVE',
    type: 'SCHOOL',
    board: pick(['CBSE', 'ICSE', 'State Board'], i),
    parentArea: { id: id2, name: pick(['Delhi', 'Maharashtra', 'Tamil Nadu'], i) },
    area: { id: id2, name: pick(['Delhi', 'Maharashtra', 'Tamil Nadu'], i) },
    address: `${100 + i} MG Road`,
    studentCount: 1200 + i * 37,
    staffCount: 64 + i * 3,
    classCount: 30 + i,
    customData: {},
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function makeList(resource, n, factory) {
  return Array.from({ length: n }, (_, i) => factory(i));
}

// Resource-specific generators keyed by the first path segment.
function genericEntity(resource, idVal, i = 0) {
  const label = resource.replace(/-/g, ' ').replace(/s$/, '');
  return {
    id: idVal,
    tenantId: TENANT,
    code: `${resource.slice(0, 3).toUpperCase()}-${1000 + i}`,
    name: `${label[0].toUpperCase()}${label.slice(1)} ${i + 1}`,
    title: `${label[0].toUpperCase()}${label.slice(1)} ${i + 1}`,
    description: `Sample ${label} used for demo data.`,
    status: pick(['ACTIVE', 'PENDING', 'APPROVED', 'DRAFT'], i),
    type: pick(['STANDARD', 'NATIONAL', 'INTERNAL'], i),
    startDate: '2025-04-01',
    endDate: '2026-03-31',
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function listFor(resource, sub) {
  const key = sub ?? resource;
  if (resource === 'students') return makeList('students', 6, person);
  if (resource === 'staff') return makeList('staff', 6, (i) => ({ ...person(i), position: pick(['Teacher', 'Principal', 'Clerk'], i), employmentStatus: 'ACTIVE' }));
  if (resource === 'institutions') return makeList('institutions', 6, institution);
  if (key === 'grades') return makeList('grades', 8, (i) => ({ id: `g${i}`, tenantId: TENANT, name: `Grade ${i + 1}`, code: `G${i + 1}`, order: i + 1 }));
  if (key === 'classes') return makeList('classes', 6, (i) => ({ id: `c${i}`, tenantId: TENANT, name: `Class ${i + 1}-A`, gradeId: `g${i}`, capacity: 40 }));
  if (key === 'academic-periods') return makeList('academic-periods', 3, (i) => ({ id: `ap${i}`, tenantId: TENANT, name: `${2024 + i}-${2025 + i}`, code: `AY${2024 + i}`, status: i === 0 ? 'ACTIVE' : 'CLOSED', startDate: `${2024 + i}-04-01`, endDate: `${2025 + i}-03-31` }));
  if (key === 'enrollments') return makeList('enrollments', 3, (i) => ({ id: `e${i}`, tenantId: TENANT, studentId: FIXED_ID, institutionId: FIXED_ID, gradeId: `g${i}`, status: pick(['ENROLLED', 'TRANSFERRED', 'GRADUATED'], i), enrolledAt: '2024-04-01', academicPeriodId: 'ap0' }));
  if (key === 'areas') return makeList('areas', 5, (i) => ({ id: `area${i}`, name: pick(['India', 'Delhi', 'Maharashtra', 'Tamil Nadu', 'Kerala'], i), level: i, parentId: i ? `area${i - 1}` : null }));
  return makeList(key, 6, (i) => genericEntity(key, i === 0 ? FIXED_ID : `${key}-${i}`, i));
}

function detailFor(resource, idVal) {
  if (resource === 'students') return person(0);
  if (resource === 'staff') return { ...person(0), position: 'Teacher', employmentStatus: 'ACTIVE' };
  if (resource === 'institutions') return institution(0);
  if (resource === 'programs') {
    return {
      ...genericEntity('programs', idVal, 0),
      name: 'Merit Scholarship 2025', status: 'ACTIVE',
      currency: 'INR', awardAmount: 25000, totalSlots: 100,
      slotsAwarded: 42, applicationsCount: 230, awardsCount: 42,
      eligibility: 'Top 10% by academic merit, household income below threshold.',
    };
  }
  if (resource === 'definitions') {
    return {
      ...genericEntity('definitions', idVal, 0),
      name: 'Student Transfer Approval', status: 'ACTIVE',
      steps: [
        { id: 's1', name: 'Principal Review', order: 1, approverRole: 'principal', slaHours: 24 },
        { id: 's2', name: 'District Officer Approval', order: 2, approverRole: 'district-officer', slaHours: 48 },
        { id: 's3', name: 'Records Update', order: 3, approverRole: 'registrar', slaHours: 12 },
      ],
    };
  }
  if (resource === 'grading-schemes') {
    return {
      ...genericEntity('grading-schemes', idVal, 0),
      name: 'CBSE Letter Grades', type: 'LETTER',
      thresholds: [
        { id: 't1', grade: 'A1', minScore: 91, maxScore: 100, label: 'Outstanding' },
        { id: 't2', grade: 'A2', minScore: 81, maxScore: 90, label: 'Excellent' },
        { id: 't3', grade: 'B1', minScore: 71, maxScore: 80, label: 'Very Good' },
        { id: 't4', grade: 'C1', minScore: 51, maxScore: 70, label: 'Good' },
      ],
    };
  }
  return genericEntity(resource, idVal, 0);
}

function infrastructureHierarchy() {
  return {
      lands: [
        {
          id: 'land1', name: 'Main Campus Land', area: '5 acres', capacity: 1500,
          buildings: [
            {
              id: 'b1', name: 'Academic Block A', capacity: 800,
              floors: [
                { id: 'f1', name: 'Ground Floor', capacity: 400, rooms: [
                  { id: 'r1', name: 'Room 101', type: 'Classroom', capacity: 40 },
                  { id: 'r2', name: 'Science Lab', type: 'Laboratory', capacity: 30 },
                ] },
                { id: 'f2', name: 'First Floor', capacity: 400, rooms: [
                  { id: 'r3', name: 'Room 201', type: 'Classroom', capacity: 40 },
                  { id: 'r4', name: 'Library', type: 'Library', capacity: 60 },
                ] },
              ],
            },
          ],
        },
      ],
  };
}

function appraisalTemplates() {
  return [
    {
      id: FIXED_ID, name: 'Annual Teacher Appraisal', description: 'Yearly performance review.',
      academicPeriodId: 'ap0', scoreMin: 0, scoreMax: 100,
      criteria: [
        { name: 'Teaching Effectiveness', description: 'Classroom delivery and outcomes', weight: 40, maxScore: 40 },
        { name: 'Student Engagement', description: 'Participation and feedback', weight: 30, maxScore: 30 },
        { name: 'Professional Development', description: 'Training and growth', weight: 30, maxScore: 30 },
      ],
      createdAt: ISO, updatedAt: ISO,
    },
  ];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Dashboard KPI payloads.
function dashboard() {
  return {
    kpis: [
      { id: 'institutions', label: 'Institutions', value: '342', delta: '+4', trend: 'up', description: 'Active schools' },
      { id: 'students', label: 'Students', value: '48,210', delta: '+1.2%', trend: 'up', description: 'Enrolled' },
      { id: 'staff', label: 'Staff', value: '3,640', delta: '+0.6%', trend: 'up', description: 'Active' },
      { id: 'attendance', label: 'Attendance', value: '93.4%', delta: '+0.8%', trend: 'up', description: 'This week' },
    ],
    enrollmentTrend: Array.from({ length: 6 }, (_, i) => ({ period: `M${i + 1}`, value: 40000 + i * 1500 })),
    boards: makeList('boards', 3, (i) => ({ id: `b${i}`, name: pick(['CBSE', 'ICSE', 'State'], i), schools: 120 - i * 10, students: 18000 - i * 2000, attendancePercent: 92 + i, passRatePercent: 88 + i, pupilTeacherRatio: 24 + i })),
    states: makeList('states', 4, (i) => ({ id: `s${i}`, name: pick(['Delhi', 'Maharashtra', 'Tamil Nadu', 'Kerala'], i), schools: 90 - i * 5, students: 15000 - i * 1500, attendancePercent: 91 + i, passRatePercent: 87 + i })),
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname.replace(/^\/api\/v1/, '').replace(/\/+$/, '');
  if (p === '') p = '/';

  // Dashboards
  if (p.startsWith('/dashboards')) return json(res, 200, dashboard());

  // Health/tenant/theme niceties
  if (p.includes('/tenant/theme') || p === '/tenant/branding') {
    return json(res, 200, { name: 'ProctiraERP', shortName: 'proctira', slug: 'proctira', primary_color: 'hsl(222,47%,31%)', accent_color: 'hsl(174,62%,40%)', logo: { url: '/logo.svg', alt: 'ProctiraERP' }, favicon: '/favicon.ico', login_background: '', document_title_template: '{page} | {brand}' });
  }

  const seg = p.split('/').filter(Boolean); // e.g. ['students','<id>','enrollments']
  if (seg.length === 0) return json(res, 200, { ok: true });

  const resource = seg[0];

  // Staff appraisal templates -> { data: [templates with criteria] }.
  if (resource === 'staff' && seg[1] === 'appraisals' && seg[2] === 'templates' && seg.length === 3) {
    return json(res, 200, { data: appraisalTemplates(), meta: meta(1) });
  }
  // Institution infrastructure hierarchy -> { lands: [...] }.
  if (resource === 'institutions' && seg[2] === 'infrastructure' && seg[3] === 'hierarchy') {
    return json(res, 200, infrastructureHierarchy());
  }
  // Canonical infrastructure hierarchy endpoint.
  if (resource === 'infrastructure' && seg[1] === 'hierarchy' && seg[2]) {
    return json(res, 200, infrastructureHierarchy());
  }

  // Special nested resources for institutions.
  if (resource === 'institutions' && seg.length === 3) {
    if (seg[2] === 'infrastructure') return json(res, 200, infrastructureHierarchy());
    // Class catalog loaders expect bare arrays.
    if (seg[2] === 'grades' || seg[2] === 'classes' || seg[2] === 'academic-periods') {
      return json(res, 200, listFor('institutions', seg[2]));
    }
  }
  // Top-level grades/classes (listGrades, etc.) -> bare array.
  if ((resource === 'grades' || resource === 'classes') && seg.length === 1) {
    return json(res, 200, listFor(resource));
  }

  // /resource              -> list
  if (seg.length === 1) {
    return json(res, 200, { data: listFor(resource), meta: meta(6) });
  }
  // /resource/<id>         -> detail
  if (seg.length === 2) {
    return json(res, 200, detailFor(resource, seg[1]));
  }
  if (seg.length >= 3) {
    // /resource/<sub>/<uuid>  -> detail of the nested resource (e.g. scholarships/programs/<id>)
    if (UUID_RE.test(seg[seg.length - 1])) {
      return json(res, 200, detailFor(seg[seg.length - 2], seg[seg.length - 1]));
    }
    // /resource/<id>/<sub>    -> sub-list
    return json(res, 200, { data: listFor(resource, seg[2]), meta: meta(6) });
  }
  return json(res, 404, { error: { code: 'NOT_FOUND', message: p } });
});

server.listen(PORT, () => console.log(`mock-gateway listening on http://localhost:${PORT}`));
