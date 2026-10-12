#!/usr/bin/env node
/**
 * PRC-L109 — contract for release.yml image-tag validity.
 *
 * release.yml builds on `release/**` branches whose names contain '/'. A raw
 * branch name is NOT a valid Docker image tag (tags match
 * [A-Za-z0-9_][A-Za-z0-9._-]{0,127}), so tagging `type=raw,value=<branch>`
 * made `docker push` fail only AFTER CI had already passed.
 *
 * This check asserts:
 *   1. the resolve step produces a sanitised `head-branch-tag` output, and
 *   2. the docker/metadata-action tag line uses `head-branch-tag` (never the
 *      raw `head-branch`) so every release branch yields a valid tag.
 *
 * It also exports `sanitizeBranchTag`, the reference implementation of the
 * sed pipeline in the resolve step, so the behaviour is unit-tested.
 *
 * Usage: node tools/scripts/check-release-image-tag.mjs [release.yml]
 * Exits 1 on any violation, invalid YAML, or missing file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkflow } from './check-workflow-step-contracts.mjs';

/**
 * Reference implementation of the resolve-step sanitiser. Replaces any char
 * outside the Docker tag alphabet with '-' and trims leading '.'/'-' (a tag
 * may not start with a separator). Returns '' for an all-separator input.
 * @param {string} branch
 * @returns {string}
 */
export function sanitizeBranchTag(branch) {
  return String(branch ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[.-]+/, '');
}

/** Docker tag grammar (reference/regexp): component after the last ':'. */
export function isValidDockerTag(tag) {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(tag);
}

/**
 * @param {Record<string, any>} wf parsed release workflow
 * @returns {string[]}
 */
export function releaseTagViolations(wf) {
  const out = [];
  const ciGate = wf.jobs?.['ci-gate'];
  if (!ciGate) {
    out.push('missing ci-gate job');
  } else {
    const outputs = ciGate.outputs ?? {};
    if (!('head-branch-tag' in outputs)) {
      out.push('ci-gate must expose a sanitised head-branch-tag output');
    }
    const resolveStep = (ciGate.steps ?? []).find((s) => s && s.id === 'resolve');
    if (!resolveStep) {
      out.push('ci-gate: missing resolve step');
    } else if (!/head-branch-tag=/.test(String(resolveStep.run ?? ''))) {
      out.push('ci-gate resolve step must compute head-branch-tag');
    }
  }

  // Find the metadata-action tag definitions anywhere in the workflow.
  let foundTagStep = false;
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (!step || !/docker\/metadata-action/.test(String(step.uses ?? ''))) continue;
      foundTagStep = true;
      const tags = String(step.with?.tags ?? '');
      if (/outputs\.head-branch\b(?!-tag)/.test(tags)) {
        out.push('metadata-action tags must not use the raw head-branch (use head-branch-tag)');
      }
      if (!/outputs\.head-branch-tag\b/.test(tags)) {
        out.push('metadata-action tags must include the sanitised head-branch-tag');
      }
    }
  }
  if (!foundTagStep) out.push('no docker/metadata-action step found');
  return out;
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  const file = process.argv[2] ?? '.github/workflows/release.yml';
  let failures;
  try {
    if (!existsSync(resolve(file))) throw new Error(`${file}: missing`);
    failures = releaseTagViolations(loadWorkflow(readFileSync(resolve(file), 'utf8'), file));
  } catch (err) {
    console.error(`check-release-image-tag: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (failures.length > 0) {
    console.error('check-release-image-tag: FAIL');
    for (const f of failures) console.error(`  - ${file}: ${f}`);
    process.exit(1);
  }
  console.log('check-release-image-tag: PASS');
}
