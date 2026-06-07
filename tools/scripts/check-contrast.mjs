#!/usr/bin/env node
/**
 * Semantic-token contrast CI gate (task 56.2 / Requirement 37 AC 2 / Design §K).
 *
 * Reads `packages/ui/styles/theme.css` and, for every semantic token pair
 * (foreground/background, primary-foreground/primary, accent-foreground/accent,
 * muted-foreground/muted, success/success-bg, warning/warning-bg, error/error-bg,
 * info/info-bg), computes the WCAG 2.1 relative-luminance contrast ratio in
 * BOTH light mode (`:root, :root.light`) and dark mode (`:root.dark`) and
 * fails when any ratio drops below the 7:1 floor mandated by Requirement 37
 * AC 2 (a stricter bar than WCAG 2.1 AA's 4.5:1).
 *
 * Usage
 *   node tools/scripts/check-contrast.mjs
 *   node tools/scripts/check-contrast.mjs --json
 *   node tools/scripts/check-contrast.mjs --theme=/abs/path/to/theme.css
 *   node tools/scripts/check-contrast.mjs --baseline=path/to/baseline.json
 *   node tools/scripts/check-contrast.mjs --strict   # ignore baseline
 *
 * Exits 0 when every active pair clears 7:1 (and any allow-listed baseline
 * pair has not regressed). Exits 1 otherwise.
 *
 * The script is also reusable as a library — `parseHsl`, `hslToRgb`,
 * `relativeLuminance`, `contrastRatio`, `parseThemeBlocks`, `evaluatePairs`,
 * and `SEMANTIC_PAIRS` are exported for the accompanying Vitest spec.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Constants
// ============================================================================

/** Requirement 37 AC 2 sets a 7:1 floor for body-text contrast in both modes. */
export const MIN_CONTRAST_RATIO = 7.0;

/**
 * Canonical semantic-token pairs to evaluate.
 *
 * Each entry names the `foreground` token painted on top of the `background`
 * token. The ordering of `foreground` and `background` does not affect the
 * computed ratio (contrast is symmetric), but the labels keep the report
 * readable for token authors.
 *
 * Requirement 37 AC 2 enumerates: background, foreground, primary, accent,
 * success, warning, error, info, muted. We pair each one with its semantically
 * intended counterpart so the gate models the actual on-screen surfaces:
 *
 *   • body text       → --foreground on --background
 *   • primary buttons → --primary-foreground on --primary
 *   • accent surfaces → --accent-foreground on --accent
 *   • muted captions  → --muted-foreground on --muted
 *   • status badges   → --success/--warning/--error/--info on their *-bg pair
 */
export const SEMANTIC_PAIRS = [
  { name: 'foreground / background', foreground: '--foreground', background: '--background' },
  {
    name: 'primary-foreground / primary',
    foreground: '--primary-foreground',
    background: '--primary',
  },
  { name: 'accent-foreground / accent', foreground: '--accent-foreground', background: '--accent' },
  { name: 'muted-foreground / muted', foreground: '--muted-foreground', background: '--muted' },
  { name: 'success / success-bg', foreground: '--success', background: '--success-bg' },
  { name: 'warning / warning-bg', foreground: '--warning', background: '--warning-bg' },
  { name: 'error / error-bg', foreground: '--error', background: '--error-bg' },
  { name: 'info / info-bg', foreground: '--info', background: '--info-bg' },
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_THEME_PATH = resolve(REPO_ROOT, 'packages/ui/styles/theme.css');
const DEFAULT_BASELINE_PATH = resolve(__dirname, 'check-contrast-baseline.json');

// ============================================================================
// Color math (HSL → RGB → relative luminance → contrast ratio)
// ============================================================================

/**
 * Parse a CSS `hsl(h, s%, l%)` color string into numeric components.
 *
 * Accepts whitespace-tolerant input (with or without commas, with or without
 * `%` after S/L) and throws on unparseable input so the caller can surface
 * an actionable error rather than silently producing NaNs.
 */
export function parseHsl(value) {
  if (typeof value !== 'string') {
    throw new Error(`parseHsl: expected string, got ${typeof value}`);
  }
  const trimmed = value.trim();
  // Match: hsl( H , S% , L% )  with commas OR spaces; tolerate `%` on S/L.
  const re =
    /^hsl\(\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)%?\s*[, ]\s*([+-]?\d+(?:\.\d+)?)%?\s*\)$/i;
  const m = trimmed.match(re);
  if (!m) {
    throw new Error(`parseHsl: cannot parse "${value}" (expected hsl(h, s%, l%))`);
  }
  const h = ((Number(m[1]) % 360) + 360) % 360;
  const s = clamp01(Number(m[2]) / 100);
  const l = clamp01(Number(m[3]) / 100);
  return { h, s, l };
}

function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Convert HSL ({ h: 0–360, s: 0–1, l: 0–1 }) to sRGB ({ r,g,b: 0–1 }).
 *
 * Uses the standard CSS Color 4 algorithm (chroma + intermediate `m`).
 * Output values are linear-domain sRGB on the [0,1] range, NOT linearized
 * (gamma still applied). `relativeLuminance` performs the gamma decode.
 */
export function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp >= 5 && hp < 6) [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: r1 + m, g: g1 + m, b: b1 + m };
}

/**
 * WCAG 2.1 relative luminance.
 *
 * Linearizes each sRGB channel via the piecewise gamma decode and combines
 * with the standard luminance weights. Input channels must be on [0,1].
 *
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance({ r, g, b }) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG 2.1 contrast ratio between two relative luminances.
 *
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * Returns a value on [1, 21]; pure white on pure black is exactly 21:1.
 */
export function contrastRatio(L1, L2) {
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Convenience: compute the contrast ratio between two CSS hsl() strings. */
export function contrastForHsl(aHsl, bHsl) {
  const La = relativeLuminance(hslToRgb(parseHsl(aHsl)));
  const Lb = relativeLuminance(hslToRgb(parseHsl(bHsl)));
  return contrastRatio(La, Lb);
}

// ============================================================================
// theme.css parser
// ============================================================================

/**
 * Strip CSS block (`/* ... *​/`) comments so the parser does not have to
 * skip over them inline. Comments are replaced with single spaces, which
 * preserves whitespace separation between selector tokens but removes any
 * `{`, `}`, `;` characters they might contain.
 */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Extract every CSS custom-property declaration inside a top-level rule
 * matching `selectorMatcher`. Returns a map of `--token` → `value`.
 *
 * The parser walks the file, tracks brace depth so it ignores nested
 * `@layer` / `@theme` blocks, and only collects declarations that appear
 * directly inside the targeted selector's outermost block. That matches
 * the way `theme.css` is authored today (flat declarations) and avoids
 * picking up unrelated `--token: value` lines from elsewhere in the file.
 *
 * The caller is expected to pass comment-stripped CSS so we do not have
 * to reason about `{`/`}`/`;` characters that appear inside comments.
 */
function extractTokensFromBlock(css, selectorMatcher) {
  const tokens = {};
  const len = css.length;
  let i = 0;
  while (i < len) {
    if (css[i] === '{') {
      // Capture the preceding selector text by scanning back to the
      // previous `}` or `;` (or BOF). Comments have already been stripped
      // by the caller, so the slice contains only selector / at-rule text.
      let s = i - 1;
      while (s >= 0) {
        const ch = css[s];
        if (ch === '}' || ch === ';') break;
        s -= 1;
      }
      const selectorText = css.slice(s + 1, i).trim();

      // Find matching `}` at this depth.
      let depth = 1;
      let j = i + 1;
      while (j < len && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        if (depth > 0) j += 1;
      }
      const blockBody = css.slice(i + 1, j);

      if (selectorMatcher(selectorText)) {
        // Collect direct `--name: value;` declarations only (skip anything
        // inside a nested brace pair so we don't leak `@theme inline` etc.).
        let depth2 = 0;
        let lineStart = 0;
        for (let k = 0; k <= blockBody.length; k += 1) {
          const ch = blockBody[k];
          if (ch === '{') depth2 += 1;
          else if (ch === '}') depth2 -= 1;
          if (depth2 === 0 && (ch === ';' || k === blockBody.length)) {
            const slice = blockBody.slice(lineStart, k);
            const m = slice.match(/^\s*(--[\w-]+)\s*:\s*([^;]+?)\s*$/);
            if (m) {
              tokens[m[1]] = m[2].trim();
            }
            lineStart = k + 1;
          }
        }
      }
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return tokens;
}

/**
 * Parse `theme.css` into `{ light, dark }` token maps.
 *
 * The theme stylesheet declares light tokens under `:root, :root.light` (so
 * the cascade also covers a freshly mounted document before `ThemeProvider`
 * adds the `.light` class) and dark tokens under `:root.dark`. We detect
 * those selector lists by string equality after whitespace collapse, which
 * keeps the parser tolerant of formatter changes.
 */
export function parseThemeBlocks(css) {
  const stripped = stripCssComments(css);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const light = extractTokensFromBlock(stripped, (sel) => {
    const n = norm(sel);
    return (
      n === ':root, :root.light' ||
      n === ':root,:root.light' ||
      n === ':root.light' ||
      n === ':root'
    );
  });
  const dark = extractTokensFromBlock(stripped, (sel) => norm(sel) === ':root.dark');
  return { light, dark };
}

// ============================================================================
// Evaluation
// ============================================================================

/**
 * For each entry in `pairs`, look up the foreground/background HSL values in
 * `tokens`, compute the contrast ratio, and return a structured result. If
 * a token is missing or unparseable the row is reported with `error` set
 * (not skipped) so missing wiring is loud.
 */
export function evaluatePairs(tokens, pairs, threshold = MIN_CONTRAST_RATIO) {
  return pairs.map((pair) => {
    const fgValue = tokens[pair.foreground];
    const bgValue = tokens[pair.background];
    if (!fgValue || !bgValue) {
      return {
        name: pair.name,
        foreground: pair.foreground,
        foregroundValue: fgValue ?? null,
        background: pair.background,
        backgroundValue: bgValue ?? null,
        ratio: null,
        passes: false,
        threshold,
        error:
          !fgValue && !bgValue
            ? `tokens missing: ${pair.foreground}, ${pair.background}`
            : !fgValue
              ? `token missing: ${pair.foreground}`
              : `token missing: ${pair.background}`,
      };
    }
    let ratio = null;
    let error = null;
    try {
      ratio = contrastForHsl(fgValue, bgValue);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      name: pair.name,
      foreground: pair.foreground,
      foregroundValue: fgValue,
      background: pair.background,
      backgroundValue: bgValue,
      ratio,
      passes: ratio !== null && ratio >= threshold,
      threshold,
      error,
    };
  });
}

// ============================================================================
// Baseline handling
// ============================================================================

/**
 * Baseline schema: `{ generatedAt, threshold, baseline: { light: [...pairs], dark: [...pairs] } }`
 * where each pair is `{ name, ratio }`. A new run is allowed to re-fail any
 * pair listed in the baseline as long as the ratio has not regressed below
 * the recorded value (i.e. the gate is monotone-tightening). Pairs that meet
 * the threshold are NEVER allowed to regress below it.
 */
export async function loadBaseline(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    const out = { light: new Map(), dark: new Map() };
    for (const mode of ['light', 'dark']) {
      for (const row of parsed?.baseline?.[mode] ?? []) {
        if (typeof row?.name === 'string' && typeof row?.ratio === 'number') {
          out[mode].set(row.name, row.ratio);
        }
      }
    }
    return { ok: true, threshold: parsed?.threshold ?? MIN_CONTRAST_RATIO, ...out };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, missing: true };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Decide whether a single failure (`row.passes === false`) should still
 * block the build. A baselined row is allowed iff (a) it appears in the
 * baseline AND (b) the new ratio has not dipped below the baselined value
 * (allowing equality so a re-run on the same theme.css is a no-op).
 */
export function isFailureWaivedByBaseline(row, baselineForMode) {
  if (!baselineForMode) return false;
  if (!baselineForMode.has(row.name)) return false;
  const baselined = baselineForMode.get(row.name);
  if (row.ratio == null) return false;
  return row.ratio + 1e-6 >= baselined;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const args = {
    theme: DEFAULT_THEME_PATH,
    baseline: DEFAULT_BASELINE_PATH,
    json: false,
    strict: false,
    quiet: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--theme=')) {
      const v = arg.slice('--theme='.length);
      args.theme = isAbsolute(v) ? v : resolve(process.cwd(), v);
    } else if (arg.startsWith('--baseline=')) {
      const v = arg.slice('--baseline='.length);
      args.baseline = isAbsolute(v) ? v : resolve(process.cwd(), v);
    } else if (arg === '--no-baseline') {
      args.baseline = null;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    [
      'Usage: check-contrast [options]',
      '',
      'Validates that every semantic token pair declared in',
      'packages/ui/styles/theme.css achieves at least 7:1 contrast in both',
      'light and dark mode (Requirement 37 AC 2).',
      '',
      'Options:',
      '  --theme=<path>      Path to theme.css (default: packages/ui/styles/theme.css)',
      '  --baseline=<path>   Path to baseline JSON (default: tools/scripts/check-contrast-baseline.json)',
      '  --no-baseline       Ignore the baseline file (synonym for --strict)',
      '  --strict            Treat baselined failures as fresh failures',
      '  --json              Emit a JSON report on stdout instead of pretty text',
      '  --quiet             Suppress the per-pair pass output',
      '  -h, --help          Show this help',
    ].join('\n'),
  );
}

function fmtRatio(r) {
  if (r === null || Number.isNaN(r)) return '   n/a ';
  return `${r.toFixed(2).padStart(5, ' ')}:1`;
}

function fmtRow(row, waived) {
  const status = row.passes ? '✅' : waived ? '⚠️ ' : '❌';
  const ratio = fmtRatio(row.ratio);
  const note = row.error ? ` — ${row.error}` : waived ? ' (baselined)' : '';
  return `  ${status} ${ratio}  ${row.name}${note}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const css = await readFile(args.theme, 'utf8');
  const blocks = parseThemeBlocks(css);

  const lightRows = evaluatePairs(blocks.light, SEMANTIC_PAIRS);
  // Dark mode tokens are layered on top of light defaults via :root inheritance,
  // so any token NOT redeclared in `:root.dark` keeps its light value. Merge
  // the light defaults under the dark overrides to model that cascade.
  const mergedDark = { ...blocks.light, ...blocks.dark };
  const darkRows = evaluatePairs(mergedDark, SEMANTIC_PAIRS);

  let baseline = null;
  if (args.baseline && !args.strict) {
    const loaded = await loadBaseline(args.baseline);
    if (loaded.ok) {
      baseline = loaded;
    } else if (!loaded.missing && !args.quiet) {
      console.warn(`⚠️  Failed to load baseline at ${args.baseline}: ${loaded.error}`);
    }
  }

  const report = {
    threshold: MIN_CONTRAST_RATIO,
    themePath: args.theme,
    baselinePath: baseline ? args.baseline : null,
    light: lightRows,
    dark: darkRows,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    if (!args.quiet) {
      console.log(`\nContrast gate (Requirement 37 AC 2 — minimum ${MIN_CONTRAST_RATIO}:1)`);
      console.log(`Theme: ${args.theme}`);
      if (baseline) console.log(`Baseline: ${args.baseline}`);
      console.log('\n— Light mode (:root, :root.light) —');
      for (const row of lightRows) {
        const waived = !row.passes && isFailureWaivedByBaseline(row, baseline?.light);
        console.log(fmtRow(row, waived));
      }
      console.log('\n— Dark mode (:root.dark) —');
      for (const row of darkRows) {
        const waived = !row.passes && isFailureWaivedByBaseline(row, baseline?.dark);
        console.log(fmtRow(row, waived));
      }
    }
  }

  // Determine exit code: count fresh (non-waived) failures.
  const fresh = [];
  for (const row of lightRows) {
    if (!row.passes && !isFailureWaivedByBaseline(row, baseline?.light)) {
      fresh.push({ mode: 'light', ...row });
    }
  }
  for (const row of darkRows) {
    if (!row.passes && !isFailureWaivedByBaseline(row, baseline?.dark)) {
      fresh.push({ mode: 'dark', ...row });
    }
  }

  if (fresh.length === 0) {
    if (!args.quiet) {
      const baselined = countBaselined(lightRows, darkRows, baseline);
      const suffix =
        baselined > 0 ? ` (${baselined} pre-existing baselined; tighten in follow-up)` : '';
      console.log(`\n✅ check-contrast: 0 fresh violations${suffix}`);
    }
    process.exit(0);
  }

  if (!args.json) {
    console.error(`\n❌ check-contrast: ${fresh.length} pair(s) below ${MIN_CONTRAST_RATIO}:1`);
    for (const row of fresh) {
      const ratio = fmtRatio(row.ratio);
      console.error(`   • [${row.mode}] ${ratio}  ${row.name}`);
    }
    console.error(`\nSee ${args.theme} and adjust the offending tokens.`);
  }
  process.exit(1);
}

function countBaselined(lightRows, darkRows, baseline) {
  if (!baseline) return 0;
  let n = 0;
  for (const row of lightRows) {
    if (!row.passes && isFailureWaivedByBaseline(row, baseline.light)) n += 1;
  }
  for (const row of darkRows) {
    if (!row.passes && isFailureWaivedByBaseline(row, baseline.dark)) n += 1;
  }
  return n;
}

// Only execute the CLI when this file is the entry point. Importing the
// module (Vitest spec) does not run main().
const isMainModule = (() => {
  try {
    return resolve(process.argv[1] ?? '') === resolve(__filename);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err) => {
    console.error(
      `check-contrast: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exit(2);
  });
}
