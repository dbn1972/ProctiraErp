const SAVED_AFTER = Date.UTC(2000, 0, 1);

/** Epoch and missing timestamps mean the settings document was never saved. */
export function isUnsavedSettingsTimestamp(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return true;
  const time = Date.parse(updatedAt);
  return Number.isNaN(time) || time < SAVED_AFTER;
}

export function tenantIdentityCopy(input: {
  slug?: string | null;
  directoryName?: string | null;
  updatedAt?: string | null;
}): { schoolLine: string; savedLine: string | null } {
  const school = input.directoryName?.trim();
  const slug = input.slug?.trim();
  const schoolLine = school
    ? slug
      ? `${school} · ${slug}`
      : school
    : 'School name is not on the directory record for this login.';
  return {
    schoolLine,
    savedLine: isUnsavedSettingsTimestamp(input.updatedAt)
      ? null
      : `Last saved ${new Date(input.updatedAt!).toLocaleString()}`,
  };
}
