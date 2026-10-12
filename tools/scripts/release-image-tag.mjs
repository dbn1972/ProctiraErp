#!/usr/bin/env node
/**
 * NEW-g3_infra_tools-003 — release image-tag sanitisation + contract helpers.
 *
 * The Release workflow (`.github/workflows/release.yml`) tags images with the
 * branch name. Branch names for `release/**` (an explicitly-included trigger)
 * contain '/', which is NOT a legal OCI/Docker tag character. An unsanitised
 * value makes `docker push` AND the cosign sign/verify steps fail, so
 * release-branch builds never produce a signed image — defeating the
 * fail-closed supply-chain control for exactly the branches intended to ship.
 *
 * This module is the single source of truth for:
 *   1. `sanitiseImageTag(branch)` — mirrors the shell `sed` in the resolve step.
 *   2. `isValidOciTag(tag)` — the OCI reference tag grammar.
 *   3. `evaluateReleaseTagContract(workflowYaml)` — asserts the workflow feeds a
 *      sanitised branch tag (never the raw head-branch) to docker/metadata-action.
 *
 * Run tests with: node --test tools/scripts/release-image-tag.test.mjs
 */

/**
 * OCI/Docker tag grammar: an ASCII word character or digit, followed by up to
 * 127 word characters, dots or dashes. '/' and other characters are illegal.
 * See distribution/reference: tag := /[\w][\w.-]{0,127}/
 */
const OCI_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Returns true when `tag` is a legal, pushable OCI image tag.
 * @param {string} tag
 * @returns {boolean}
 */
export function isValidOciTag(tag) {
  return typeof tag === 'string' && OCI_TAG_RE.test(tag);
}

/**
 * Sanitise a git branch/ref name into a legal OCI tag. Mirrors the shell:
 *   printf '%s' "$BRANCH" | sed -E 's/[^A-Za-z0-9._-]/-/g; s/^[._-]+//'
 * then truncates to 128 characters.
 * @param {string} branch
 * @returns {string}
 */
export function sanitiseImageTag(branch) {
  const raw = String(branch ?? '');
  // Replace every character outside the legal set with '-'.
  const replaced = raw.replace(/[^A-Za-z0-9._-]/g, '-');
  // A tag's first character may not be '.', '-' or '_'; strip leading seps.
  const trimmed = replaced.replace(/^[._-]+/, '');
  return trimmed.slice(0, 128);
}

/**
 * Contract check over the Release workflow source. Fails if the branch tag fed
 * to docker/metadata-action still interpolates the raw `head-branch` output
 * (which can contain '/') instead of a sanitised `head-branch-tag`.
 * @param {string} workflowYaml raw contents of release.yml
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function evaluateReleaseTagContract(workflowYaml) {
  const violations = [];
  const text = String(workflowYaml ?? '');

  // The resolve step must emit a sanitised branch tag output.
  if (!/head-branch-tag\s*=/.test(text) && !/head-branch-tag:\s/.test(text)) {
    violations.push('ci-gate resolve step does not emit a sanitised `head-branch-tag` output');
  }

  // The metadata-action branch tag must use head-branch-tag, not raw head-branch.
  const rawBranchTag = /type=raw,value=\$\{\{\s*needs\.ci-gate\.outputs\.head-branch\s*\}\}/.test(
    text,
  );
  if (rawBranchTag) {
    violations.push(
      'docker/metadata-action tags still use the raw `head-branch` (may contain "/") as an image tag',
    );
  }
  const sanitisedBranchTag =
    /type=raw,value=\$\{\{\s*needs\.ci-gate\.outputs\.head-branch-tag\s*\}\}/.test(text);
  if (!sanitisedBranchTag) {
    violations.push(
      'docker/metadata-action does not tag with the sanitised `head-branch-tag` output',
    );
  }

  return { ok: violations.length === 0, violations };
}
