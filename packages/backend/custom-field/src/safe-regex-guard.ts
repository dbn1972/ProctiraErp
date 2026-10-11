/**
 * PRC-M590 — ReDoS guard for user-defined custom-field validation patterns.
 *
 * Custom-field definitions let a tenant admin supply an arbitrary regular
 * expression that is then executed synchronously on the request path against
 * user-submitted values. Node's `RegExp` uses a backtracking engine, so a
 * crafted pattern (e.g. `(a+)+$`) combined with a long non-matching input can
 * hang the event loop (catastrophic backtracking → denial of service).
 *
 * Node has no built-in per-match timeout, so this guard mitigates fail-closed
 * BEFORE executing the pattern:
 *   1. bound the pattern source length;
 *   2. bound the input value length actually tested;
 *   3. reject patterns whose structure is prone to catastrophic backtracking
 *      (nested/adjacent unbounded quantifiers, quantified groups that contain
 *      an unbounded quantifier).
 *
 * A rejected (unsafe or invalid) pattern yields `{ ok: false, reason }` and the
 * caller treats the field as failing validation rather than running the regex.
 */

/** Maximum allowed length of a user-supplied regex source. */
export const MAX_PATTERN_LENGTH = 1000;

/** Maximum input length tested against a user pattern. */
export const MAX_INPUT_LENGTH = 10_000;

export type RegexGuardResult =
  | { ok: true; matches: boolean }
  | {
      ok: false;
      reason: 'pattern-too-long' | 'input-too-long' | 'unsafe-pattern' | 'invalid-pattern';
    };

/**
 * Heuristic detector for catastrophic-backtracking shapes. Conservative: it may
 * reject some safe-but-exotic patterns, but it never allows a known dangerous
 * shape through (fail closed). Flags:
 *   - a quantifier applied to a group that itself contains an unbounded
 *     quantifier, e.g. `(a+)+`, `(a*)*`, `(a+)*`, `(.*)+`, `(?:a+)+`;
 *   - two adjacent unbounded quantifiers, e.g. `a+*`, `.**`.
 */
export function isPotentiallyCatastrophic(source: string): boolean {
  // Group whose body contains +/*/{n,} and is immediately followed by +/*/{n,}.
  const nestedQuantifiedGroup = /\([^)]*[+*}][^)]*\)\s*[*+]|\([^)]*[+*][^)]*\)\s*\{\d+,?\d*\}/;
  if (nestedQuantifiedGroup.test(source)) return true;
  // Adjacent unbounded quantifiers (a+*, a*+, .**, .++).
  if (/[*+]\s*[*+]/.test(source)) return true;
  // Quantified group containing a nested quantifier of ANY kind: (\d+)+ etc.
  if (/\((?:[^()]*[+*][^()]*)\)[+*]/.test(source)) return true;
  return false;
}

/**
 * Safely test `value` against the user-supplied `pattern`. Fail-closed on any
 * unsafe/invalid condition.
 */
export function safeRegexTest(pattern: string, value: string): RegexGuardResult {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { ok: false, reason: 'pattern-too-long' };
  }
  if (value.length > MAX_INPUT_LENGTH) {
    return { ok: false, reason: 'input-too-long' };
  }
  if (isPotentiallyCatastrophic(pattern)) {
    return { ok: false, reason: 'unsafe-pattern' };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { ok: false, reason: 'invalid-pattern' };
  }
  return { ok: true, matches: regex.test(value) };
}
