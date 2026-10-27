#!/usr/bin/env node
/**
 * PRC-L109 — derive a valid OCI image tag from a release branch name.
 *
 * release.yml used the raw branch name as an image tag, so `release/2026.10`
 * produced an invalid tag (`/` is not allowed) and the buildx push failed late.
 * toImageTag():
 *   - replaces every character outside [A-Za-z0-9_.-] (including `/`) with `-`
 *   - strips leading `.` and `-` (a tag must start with [A-Za-z0-9_])
 *   - truncates to 128 characters
 *   - validates against ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ and throws otherwise
 * `main` and `develop` are unchanged.
 *
 * Usage: node tools/scripts/release-image-tag.mjs <branch>   (prints the tag)
 * Dependency-free (node: built-ins only).
 */
export const OCI_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export function toImageTag(branch) {
  const raw = String(branch ?? '');
  const tag = raw
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 128);
  if (!OCI_TAG_RE.test(tag)) {
    throw new Error(`branch ${JSON.stringify(raw)} does not map to a valid image tag`);
  }
  return tag;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    process.stdout.write(`${toImageTag(process.argv[2])}\n`);
  } catch (err) {
    console.error(`release-image-tag: ${err.message}`);
    process.exit(1);
  }
}
