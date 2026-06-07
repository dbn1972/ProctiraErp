/**
 * Tests for the Lighthouse CI gate (task 55.7 / Requirement 39 AC 2 /
 * Property F-10 / Design §J).
 *
 * Covers the pure functions exported by `check-lighthouse.mjs`:
 *   - `SCORE_THRESHOLDS` — exactly the four named in Property F-10
 *   - `PROFILES` — both desktop and mobile-3g
 *   - `evaluateLhrAgainstThresholds` — returns `passed=true` when every
 *     category score is at or above its threshold, `false` when any one
 *     dips below, and `false` when the report shape is broken
 *   - `resolveLhciBinary` — picks the workspace-local `.bin/lhci` if it
 *     exists, else falls back to the repo-root one, else returns `null`
 *
 * The lhci config (`apps/web/lighthouserc.cjs`) is a sibling source of
 * truth for the same thresholds; we assert the two copies match so the
 * gate cannot drift.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// @ts-expect-error - direct .mjs import; types are not generated.
import * as gate from '../check-lighthouse.mjs';

// @ts-expect-error - direct .cjs import for cross-source-of-truth assertion
import * as lhciConfig from '../../../apps/web/lighthouserc.cjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('SCORE_THRESHOLDS — Property F-10', () => {
  it('matches the four numbers named by Property F-10', () => {
    expect(gate.SCORE_THRESHOLDS).toEqual({
      accessibility: 0.95,
      performance: 0.8,
      'best-practices': 0.9,
      seo: 0.9,
    });
  });

  it('is frozen so callers cannot mutate it accidentally', () => {
    expect(Object.isFrozen(gate.SCORE_THRESHOLDS)).toBe(true);
  });

  it('matches the thresholds embedded in apps/web/lighthouserc.cjs', () => {
    // The lhci config exports the same numbers under the same keys so
    // there is exactly one source of truth, even if the wrapper and the
    // config are wired through different code paths.
    expect(lhciConfig.SCORE_THRESHOLDS).toEqual(gate.SCORE_THRESHOLDS);
  });
});

describe('PROFILES — desktop + mobile-3g', () => {
  it('lists exactly the two profiles named by Requirement 39 / Design §J', () => {
    expect(gate.PROFILES).toEqual(['desktop', 'mobile-3g']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(gate.PROFILES)).toBe(true);
  });
});

describe('MOBILE_3G_THROTTLING — values literally from Requirement 39.2', () => {
  it('uses 1.6 Mbps downlink, 750 ms RTT, 4× CPU slowdown', () => {
    expect(lhciConfig.MOBILE_3G_THROTTLING).toEqual({
      rttMs: 750,
      throughputKbps: 1638,
      requestLatencyMs: 750 * 3.75,
      downloadThroughputKbps: 1638,
      uploadThroughputKbps: 750,
      cpuSlowdownMultiplier: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateLhrAgainstThresholds
// ---------------------------------------------------------------------------

/**
 * Build a minimal Lighthouse report (just enough for the evaluator).
 * Real lhr objects carry far more fields; the evaluator only reads
 * `categories[<id>].score`, so we keep the fixture tight.
 */
function makeLhr(scores: Record<string, number | null>) {
  const categories: Record<string, { score: number | null }> = {};
  for (const [k, v] of Object.entries(scores)) {
    categories[k] = { score: v };
  }
  return { categories };
}

describe('evaluateLhrAgainstThresholds — verdict logic', () => {
  it('returns passed=true when every score meets its threshold exactly', () => {
    const lhr = makeLhr({
      accessibility: 0.95,
      performance: 0.8,
      'best-practices': 0.9,
      seo: 0.9,
    });
    const verdict = gate.evaluateLhrAgainstThresholds(lhr);
    expect(verdict.passed).toBe(true);
    expect(verdict.scores.accessibility.passed).toBe(true);
    expect(verdict.scores.performance.passed).toBe(true);
    expect(verdict.scores['best-practices'].passed).toBe(true);
    expect(verdict.scores.seo.passed).toBe(true);
  });

  it('returns passed=true when every score is comfortably above threshold', () => {
    const lhr = makeLhr({
      accessibility: 1.0,
      performance: 0.99,
      'best-practices': 1.0,
      seo: 1.0,
    });
    expect(gate.evaluateLhrAgainstThresholds(lhr).passed).toBe(true);
  });

  it('fails when accessibility drops to 0.94 (one tick below 0.95)', () => {
    const lhr = makeLhr({
      accessibility: 0.94,
      performance: 0.99,
      'best-practices': 1.0,
      seo: 1.0,
    });
    const verdict = gate.evaluateLhrAgainstThresholds(lhr);
    expect(verdict.passed).toBe(false);
    expect(verdict.scores.accessibility.passed).toBe(false);
    expect(verdict.scores.performance.passed).toBe(true);
  });

  it('fails when performance drops to 0.79', () => {
    const lhr = makeLhr({
      accessibility: 1.0,
      performance: 0.79,
      'best-practices': 1.0,
      seo: 1.0,
    });
    const verdict = gate.evaluateLhrAgainstThresholds(lhr);
    expect(verdict.passed).toBe(false);
    expect(verdict.scores.performance.passed).toBe(false);
  });

  it('fails when best-practices drops to 0.89', () => {
    const lhr = makeLhr({
      accessibility: 1.0,
      performance: 1.0,
      'best-practices': 0.89,
      seo: 1.0,
    });
    const verdict = gate.evaluateLhrAgainstThresholds(lhr);
    expect(verdict.passed).toBe(false);
    expect(verdict.scores['best-practices'].passed).toBe(false);
  });

  it('fails when seo drops to 0.89', () => {
    const lhr = makeLhr({
      accessibility: 1.0,
      performance: 1.0,
      'best-practices': 1.0,
      seo: 0.89,
    });
    const verdict = gate.evaluateLhrAgainstThresholds(lhr);
    expect(verdict.passed).toBe(false);
    expect(verdict.scores.seo.passed).toBe(false);
  });

  it('treats a missing category as a failure (score=null, passed=false)', () => {
    const lhr = makeLhr({
      accessibility: 1.0,
      performance: 1.0,
      'best-practices': 1.0,
      // seo missing entirely
    });
    const verdict = gate.evaluateLhrAgainstThresholds(lhr);
    expect(verdict.passed).toBe(false);
    expect(verdict.scores.seo).toEqual({
      score: null,
      threshold: 0.9,
      passed: false,
    });
  });

  it('returns passed=false with reason when the lhr shape is broken', () => {
    expect(gate.evaluateLhrAgainstThresholds(null).passed).toBe(false);
    expect(gate.evaluateLhrAgainstThresholds({}).passed).toBe(false);
    expect(gate.evaluateLhrAgainstThresholds({ categories: null }).passed).toBe(false);
    const verdict = gate.evaluateLhrAgainstThresholds({});
    expect(verdict.reason).toBeTruthy();
  });

  it('accepts a custom thresholds map (used by the property test)', () => {
    const lhr = makeLhr({ accessibility: 0.5 });
    const verdict = gate.evaluateLhrAgainstThresholds(lhr, {
      accessibility: 0.4,
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.scores.accessibility).toEqual({
      score: 0.5,
      threshold: 0.4,
      passed: true,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveLhciBinary
// ---------------------------------------------------------------------------

let workspaceFixture: string;

beforeAll(() => {
  workspaceFixture = mkdtempSync(join(tmpdir(), 'check-lighthouse-test-'));
});

afterAll(() => {
  rmSync(workspaceFixture, { recursive: true, force: true });
});

describe('resolveLhciBinary — discovery order', () => {
  it('returns null when neither candidate exists', () => {
    const empty = mkdtempSync(join(tmpdir(), 'check-lighthouse-empty-'));
    const empty2 = mkdtempSync(join(tmpdir(), 'check-lighthouse-empty-'));
    try {
      expect(gate.resolveLhciBinary({ appWebRoot: empty, repoRoot: empty2 })).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
      rmSync(empty2, { recursive: true, force: true });
    }
  });

  it('prefers the workspace-local .bin/lhci over the repo-root one', () => {
    const appWeb = mkdtempSync(join(tmpdir(), 'check-lighthouse-apps-web-'));
    const repo = mkdtempSync(join(tmpdir(), 'check-lighthouse-repo-'));
    try {
      mkdirSync(join(appWeb, 'node_modules', '.bin'), { recursive: true });
      mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
      writeFileSync(join(appWeb, 'node_modules', '.bin', 'lhci'), '#!/bin/sh');
      writeFileSync(join(repo, 'node_modules', '.bin', 'lhci'), '#!/bin/sh');
      const resolved = gate.resolveLhciBinary({
        appWebRoot: appWeb,
        repoRoot: repo,
      });
      expect(resolved).toBe(join(appWeb, 'node_modules', '.bin', 'lhci'));
    } finally {
      rmSync(appWeb, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('falls back to the repo-root .bin/lhci when only that one exists', () => {
    const appWeb = mkdtempSync(join(tmpdir(), 'check-lighthouse-apps-web-'));
    const repo = mkdtempSync(join(tmpdir(), 'check-lighthouse-repo-'));
    try {
      mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
      writeFileSync(join(repo, 'node_modules', '.bin', 'lhci'), '#!/bin/sh');
      const resolved = gate.resolveLhciBinary({
        appWebRoot: appWeb,
        repoRoot: repo,
      });
      expect(resolved).toBe(join(repo, 'node_modules', '.bin', 'lhci'));
    } finally {
      rmSync(appWeb, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// lhciConfig.ROUTES — Requirement 39 / Property F-10
// ---------------------------------------------------------------------------

describe('lhci ROUTES — Requirement 39 / Property F-10', () => {
  it('names exactly the three routes Requirement 39 lists', () => {
    const canonicals = lhciConfig.ROUTES.map((r: { canonical: string }) => r.canonical);
    expect(canonicals).toEqual(['/auth/signin', '/app/dashboard', '/app/attendance']);
  });

  it('marks /auth/signin as anonymous and the two app routes as authenticated', () => {
    const byCanonical = Object.fromEntries(
      lhciConfig.ROUTES.map((r: { canonical: string; requiresAuth: boolean }) => [
        r.canonical,
        r.requiresAuth,
      ]),
    );
    expect(byCanonical['/auth/signin']).toBe(false);
    expect(byCanonical['/app/dashboard']).toBe(true);
    expect(byCanonical['/app/attendance']).toBe(true);
  });
});
