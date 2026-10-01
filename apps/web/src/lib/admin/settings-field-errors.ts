/**
 * Map Zod issue paths from the tenant settings action onto the form's input
 * ids (PRC-L066). `flatten().fieldErrors` keeps only top-level keys, so a bad
 * `branding.primaryColor` surfaced as a raw "branding: ..." line instead of
 * under the Primary colour input.
 */
const NESTED_FIELD_IDS: Record<string, string> = {
  'branding.primaryColor': 'primaryColor',
  'branding.accentColor': 'accentColor',
  'branding.logoUrl': 'logoUrl',
  'contact.email': 'contactEmail',
  'contact.phone': 'contactPhone',
};

export function settingsIssuesToFieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const segments = issue.path.map(String);
    const dotted = segments.join('.');
    // Array members (supportedLocales.2) belong to their list input.
    const id = NESTED_FIELD_IDS[dotted] ?? segments[0];
    if (id && !out[id]) out[id] = issue.message;
  }
  return out;
}
