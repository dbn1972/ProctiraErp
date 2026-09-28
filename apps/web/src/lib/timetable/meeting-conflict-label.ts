const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface MeetingClash {
  reason: string;
  dayOfWeek: number;
  periodId: string;
  staffId?: string;
  sectionId?: string;
}

/** Name the teacher and the slot they already occupy. */
export function formatTeacherClash(input: {
  teacherLabel: string;
  dayOfWeek: number;
  periodLabel: string;
  sectionLabel: string;
}): string {
  const teacher = input.teacherLabel.split(' · ')[0]?.trim() || 'This teacher';
  const section = input.sectionLabel.split(' · ')[0]?.trim() || 'another section';
  const day = DAYS[input.dayOfWeek] ?? `day ${input.dayOfWeek}`;
  const period = input.periodLabel.replace(/^.*?·\s*/, '');
  return `${teacher} already teaches ${section} on ${day} · ${period}. Choose another period or staff member.`;
}

export function formatSubstituteClash(input: {
  teacherLabel: string;
  dayOfWeek: number;
  periodLabel: string;
  sectionLabel: string;
}): string {
  const teacher = input.teacherLabel.split(' · ')[0]?.trim() || 'This teacher';
  const section = input.sectionLabel.split(' · ')[0]?.trim() || 'another section';
  const day = DAYS[input.dayOfWeek] ?? `day ${input.dayOfWeek}`;
  const period = input.periodLabel.replace(/^.*?·\s*/, '');
  return `${teacher} is already teaching ${section} on ${day} · ${period}. Pick another substitute.`;
}
