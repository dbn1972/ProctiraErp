/**
 * HN-R5: every row whose student could not be resolved shows the same visible
 * "Unknown student", so a screen-reader links list could not tell those links apart.
 * The returned function gives such rows an accessible name with an ordinal and a row
 * detail; the visible text stays its prefix (WCAG 2.5.3 label in name). Rows with a
 * resolved name get `undefined` and keep their visible text as the accessible name.
 */
export function createUnknownStudentLabeler(unknownLabel: string) {
  let ordinal = 0;
  return (name: string, detail: string): string | undefined => {
    if (name !== unknownLabel) return undefined;
    ordinal += 1;
    const suffix = detail.trim() ? `, ${detail.trim()}` : '';
    return `${unknownLabel} ${ordinal}${suffix}`;
  };
}
