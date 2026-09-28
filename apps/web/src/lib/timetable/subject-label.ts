/** Short cell titles for the institution week grid ("9-B Maths"). */

export function classBand(sectionName: string): string | null {
  const match = sectionName.match(/(\d+)\s*-\s*([A-Za-z])/);
  if (!match) return null;
  return `${match[1]}-${match[2]!.toUpperCase()}`;
}

export function shortSubject(sectionName: string): string {
  const subject = sectionName.replace(/^Class\s+\d+\s*-\s*[A-Za-z]\s*/i, '').trim();
  return subject
    .replace(/Mathematics/i, 'Maths')
    .replace(/Computer Science/i, 'Comp. Sci')
    .replace(/Social Science/i, 'Social Sc.')
    .replace(/Social Studies/i, 'Social Sc.');
}

export function slotTitle(sectionName: string): string {
  const band = classBand(sectionName);
  const subject = shortSubject(sectionName);
  return band ? `${band} ${subject}` : subject || sectionName;
}

const TONES = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;

export function subjectTone(sectionName: string): (typeof TONES)[number] {
  const subject = shortSubject(sectionName).toLowerCase();
  if (subject.includes('math')) return 'c1';
  if (subject.includes('science') && !subject.includes('social') && !subject.includes('comp'))
    return 'c2';
  if (subject.includes('english')) return 'c3';
  if (subject.includes('hindi')) return 'c4';
  return 'c5';
}
