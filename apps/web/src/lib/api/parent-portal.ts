/**
 * Parent portal service client.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface ParentChildLink {
  id: string;
  tenantId: string;
  parentUserId: string;
  studentId: string;
  relationship: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LinkChildInput {
  parentUserId?: string;
  studentId: string;
  relationship?: 'guardian' | 'mother' | 'father' | 'other';
}

export interface MessageThread {
  id: string;
  tenantId: string;
  studentId: string;
  subject: string;
  createdBy: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  tenantId: string;
  senderUserId: string;
  senderRole: string;
  body: string;
  createdAt: string;
}

export interface CreateThreadInput {
  studentId: string;
  subject: string;
  body: string;
}

export interface ConsentRequest {
  id: string;
  tenantId: string;
  studentId: string;
  parentUserId: string;
  consentType: string;
  title: string;
  description: string;
  status: string;
  decidedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeeInvoice {
  id: string;
  tenantId: string;
  studentId: string;
  planId: string | null;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  dueAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeePayment {
  id: string;
  invoiceId: string;
  tenantId: string;
  payerUserId: string;
  amountCents: number;
  method: string;
  status: string;
  paidAt: string;
  createdAt: string;
}

export interface FeePlan {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  frequency: string;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeeReceipt {
  id: string;
  tenantId: string;
  paymentId: string;
  invoiceId: string;
  receiptNumber: string;
  amountCents: number;
  currency: string;
  issuedAt: string;
  createdAt: string;
}

export interface CreateFeePlanInput {
  code?: string;
  name: string;
  description?: string;
  amountCents: number;
  currency?: string;
  frequency?: 'once' | 'term' | 'month' | 'year';
}

export interface CreateInvoiceInput {
  studentId: string;
  planId?: string;
  title?: string;
  description?: string;
  amountCents?: number;
  currency?: string;
  dueAt?: string;
}

export interface AcademicMeta {
  source: 'postgres' | 'none';
  studentId: string;
}

export interface AttendanceDay {
  date: string;
  status: string;
  classId: string | null;
  comment: string | null;
}

export interface AttendancePayload {
  data: AttendanceDay[];
  summary: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    other: number;
    percentage: number | null;
  };
  meta: AcademicMeta;
}

export interface PublishedGrade {
  id: string;
  sectionId: string | null;
  assessmentCode: string | null;
  numericScore: number | null;
  letterGrade: string | null;
  workflowStatus: string;
  lockedAt: string | null;
  enteredAt: string;
}

export interface ReportCardSummary {
  id: string;
  academicPeriodId: string | null;
  status: string;
  outputUrl: string | null;
  completedAt: string | null;
}

export interface GradesPayload {
  data: PublishedGrade[];
  reportCards: ReportCardSummary[];
  meta: AcademicMeta;
}

export interface TimetableSlot {
  id: string;
  sectionId: string;
  sectionName: string | null;
  dayOfWeek: number;
  periodName: string | null;
  startTime: string | null;
  endTime: string | null;
  roomName: string | null;
}

export interface HomeworkItem {
  id: string;
  title: string;
  kind: string;
  subject: string | null;
  dueAt: string | null;
  status: string;
}

/** Parent academic 360 — LMS depth beyond a flat homework list. */
export interface LmsAssignmentItem {
  id: string;
  title: string;
  kind: string;
  subject: string | null;
  dueAt: string | null;
  maxScore: number | null;
  status: string;
  submissionStatus: string | null;
  score: number | null;
  gradedAt: string | null;
  feedback: string | null;
}

export interface LmsPayload {
  data: LmsAssignmentItem[];
  summary: {
    assigned: number;
    submitted: number;
    graded: number;
    missing: number;
    averageScorePercent: number | null;
  };
  meta: AcademicMeta;
}

export interface ReportCardSubjectLine {
  subject: string;
  numericScore: number | null;
  letterGrade: string | null;
  remarks: string | null;
}

export interface ReportCardDetail {
  id: string;
  academicPeriodId: string | null;
  status: string;
  outputUrl: string | null;
  completedAt: string | null;
  subjects: ReportCardSubjectLine[];
}

export interface CalendarEventItem {
  id: string;
  kind: string;
  name: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  academicPeriodId: string;
}

export interface NoticeItem {
  id: string;
  title: string;
  body: string | null;
  channel: string | null;
  sentAt: string | null;
}

export interface PalPlanItem {
  skillId: string;
  skillName: string | null;
  subject: string | null;
  bucket: 'review' | 'reinforce' | 'introduce';
  mastery: number | null;
  dueAt: string | null;
}

export type AcademicView =
  | 'attendance'
  | 'grades'
  | 'timetable'
  | 'homework'
  | 'calendar'
  | 'notices'
  | 'lms'
  | 'report-cards'
  | 'pal';

export interface AcademicFetchResult<T> {
  ok: boolean;
  status: number;
  payload: T | null;
  message?: string;
}

async function fetchAcademic<T>(path: string): Promise<AcademicFetchResult<T>> {
  const result = await gatewayFetch<T>(path, { throwOnError: false, next: { revalidate: 0 } });
  if (result.ok && result.data) {
    return { ok: true, status: result.status, payload: result.data };
  }
  return {
    ok: false,
    status: result.status,
    payload: null,
    message: result.error?.message ?? 'Unable to load this page.',
  };
}

export function childAcademicPath(studentId: string, view: AcademicView): string {
  return `/parent-portal/children/${studentId}/${view}`;
}

export async function getChildAttendance(studentId: string) {
  return fetchAcademic<AttendancePayload>(childAcademicPath(studentId, 'attendance'));
}

export async function getChildGrades(studentId: string) {
  return fetchAcademic<GradesPayload>(childAcademicPath(studentId, 'grades'));
}

export async function getChildTimetable(studentId: string) {
  return fetchAcademic<{ data: TimetableSlot[]; meta: AcademicMeta }>(
    childAcademicPath(studentId, 'timetable'),
  );
}

export async function getChildHomework(studentId: string) {
  return fetchAcademic<{ data: HomeworkItem[]; meta: AcademicMeta }>(
    childAcademicPath(studentId, 'homework'),
  );
}

export async function getChildLms(studentId: string) {
  return fetchAcademic<LmsPayload>(childAcademicPath(studentId, 'lms'));
}

export async function getChildReportCards(studentId: string) {
  return fetchAcademic<{ data: ReportCardDetail[]; meta: AcademicMeta }>(
    childAcademicPath(studentId, 'report-cards'),
  );
}

export async function getChildPalPlan(studentId: string) {
  return fetchAcademic<{ data: PalPlanItem[]; meta: AcademicMeta }>(
    childAcademicPath(studentId, 'pal'),
  );
}

export async function getChildCalendar(studentId: string) {
  return fetchAcademic<{ data: CalendarEventItem[]; meta: AcademicMeta }>(
    childAcademicPath(studentId, 'calendar'),
  );
}

export async function getChildNotices(studentId: string) {
  return fetchAcademic<{ data: NoticeItem[]; meta: AcademicMeta }>(
    childAcademicPath(studentId, 'notices'),
  );
}

export async function getSelfAttendance() {
  return fetchAcademic<AttendancePayload>('/student-portal/me/attendance');
}

export async function getSelfGrades() {
  return fetchAcademic<GradesPayload>('/student-portal/me/grades');
}

export async function getSelfTimetable() {
  return fetchAcademic<{ data: TimetableSlot[]; meta: AcademicMeta }>(
    '/student-portal/me/timetable',
  );
}

export async function getSelfHomework() {
  return fetchAcademic<{ data: HomeworkItem[]; meta: AcademicMeta }>('/student-portal/me/homework');
}

export async function getSelfLms() {
  return fetchAcademic<LmsPayload>('/student-portal/me/lms');
}

export async function getSelfReportCards() {
  return fetchAcademic<{ data: ReportCardDetail[]; meta: AcademicMeta }>(
    '/student-portal/me/report-cards',
  );
}

export async function getSelfCalendar() {
  return fetchAcademic<{ data: CalendarEventItem[]; meta: AcademicMeta }>(
    '/student-portal/me/calendar',
  );
}

export async function getSelfNotices() {
  return fetchAcademic<{ data: NoticeItem[]; meta: AcademicMeta }>('/student-portal/me/notices');
}

export async function getSelfPalPlan() {
  return fetchAcademic<{ data: PalPlanItem[]; meta: AcademicMeta }>('/student-portal/me/pal');
}

export async function listChildren(): Promise<ParentChildLink[]> {
  const result = await gatewayFetch<{ data: ParentChildLink[] }>('/parent-portal/children', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function linkChild(input: LinkChildInput): Promise<ParentChildLink> {
  const result = await gatewayFetch<ParentChildLink>('/parent-portal/children/links', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'LINK_FAILED',
      message: result.error?.message ?? 'Failed to link child',
    });
  }
  return result.data;
}

export async function listThreads(): Promise<MessageThread[]> {
  const result = await gatewayFetch<{ data: MessageThread[] }>('/parent-portal/messages/threads', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createThread(
  input: CreateThreadInput,
): Promise<{ thread: MessageThread; message: Message }> {
  const result = await gatewayFetch<{ thread: MessageThread; message: Message }>(
    '/parent-portal/messages/threads',
    {
      method: 'POST',
      json: input,
    },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create thread',
    });
  }
  return result.data;
}

export async function listMessages(threadId: string): Promise<Message[]> {
  const result = await gatewayFetch<{ data: Message[] }>(
    `/parent-portal/messages/threads/${threadId}/messages`,
    {
      throwOnError: false,
      next: { revalidate: 0 },
    },
  );
  return result.data?.data ?? [];
}

export async function replyToThread(threadId: string, body: string): Promise<Message> {
  const result = await gatewayFetch<Message>(
    `/parent-portal/messages/threads/${threadId}/messages`,
    {
      method: 'POST',
      json: { body },
    },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'REPLY_FAILED',
      message: result.error?.message ?? 'Failed to send reply',
    });
  }
  return result.data;
}

export async function listConsents(): Promise<ConsentRequest[]> {
  const result = await gatewayFetch<{ data: ConsentRequest[] }>('/parent-portal/consents', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function decideConsent(
  id: string,
  status: 'approved' | 'denied',
): Promise<ConsentRequest> {
  const result = await gatewayFetch<ConsentRequest>(`/parent-portal/consents/${id}/decide`, {
    method: 'POST',
    json: { status },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DECIDE_FAILED',
      message: result.error?.message ?? 'Failed to decide consent',
    });
  }
  return result.data;
}

export async function listInvoices(scope: 'parent' | 'staff' = 'parent'): Promise<FeeInvoice[]> {
  const qs = scope === 'staff' ? '?scope=staff' : '';
  const result = await gatewayFetch<{ data: FeeInvoice[] }>(`/parent-portal/fees/invoices${qs}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createInvoice(input: CreateInvoiceInput): Promise<FeeInvoice> {
  const result = await gatewayFetch<FeeInvoice>('/parent-portal/fees/invoices', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_INVOICE_FAILED',
      message: result.error?.message ?? 'Failed to create invoice',
    });
  }
  return result.data;
}

export async function listFeePlans(): Promise<FeePlan[]> {
  const result = await gatewayFetch<{ data: FeePlan[] }>('/parent-portal/fees/plans', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createFeePlan(input: CreateFeePlanInput): Promise<FeePlan> {
  const result = await gatewayFetch<FeePlan>('/parent-portal/fees/plans', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_PLAN_FAILED',
      message: result.error?.message ?? 'Failed to create fee plan',
    });
  }
  return result.data;
}

export async function listPayments(): Promise<FeePayment[]> {
  const result = await gatewayFetch<{ data: FeePayment[] }>('/parent-portal/fees/payments', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listReceipts(scope: 'parent' | 'staff' = 'parent'): Promise<FeeReceipt[]> {
  const qs = scope === 'staff' ? '?scope=staff' : '';
  const result = await gatewayFetch<{ data: FeeReceipt[] }>(`/parent-portal/fees/receipts${qs}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function payInvoice(
  id: string,
  method: 'sandbox' | 'upi' | 'card' | 'cash' = 'sandbox',
): Promise<{ invoice: FeeInvoice; payment: FeePayment; receipt: FeeReceipt }> {
  const result = await gatewayFetch<{
    invoice: FeeInvoice;
    payment: FeePayment;
    receipt: FeeReceipt;
  }>(`/parent-portal/fees/invoices/${id}/pay`, {
    method: 'POST',
    json: { method },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'PAY_FAILED',
      message: result.error?.message ?? 'Failed to pay invoice',
    });
  }
  return result.data;
}
