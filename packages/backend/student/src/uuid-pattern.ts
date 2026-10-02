/**
 * Shared UUID pattern for student-domain TypeBox schemas (PRC-L161).
 * Accepts RFC 9562 versions 1-8 (incl. v7 time-ordered ids), not only v4.
 */
export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
