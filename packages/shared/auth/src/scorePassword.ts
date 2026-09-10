/**
 * Shared password-strength scoring (Task 49.6, Requirement 4 AC 14).
 *
 * The platform needs a single scoring algorithm that drives:
 *   • the `<PasswordStrengthMeter>` rendered inline on Sign-Up / Reset
 *     Password (so the user sees real-time feedback), and
 *   • the server-side rejection of `weak` passwords on
 *     `POST /api/v1/auth/signup` and the equivalent reset endpoints
 *     (so a hand-rolled HTTP client can never bypass the meter).
 *
 * Putting the function in `@proctira/auth` keeps the contract identical
 * across the React shell, the Next.js route handlers, and the Fastify
 * Auth Service — change the table once and every surface follows. The
 * function is intentionally *pure* (no I/O, no mutable state) so it can
 * be unit-tested without fixtures and reused server-side without
 * serialisation cost.
 *
 * ## Scoring (design.md §D, "Password strength scoring algorithm")
 *
 * Each row contributes the listed delta to the running score:
 *
 * | Input dimension                                         | Contribution |
 * |---------------------------------------------------------|--------------|
 * | Length ≥ 8                                              | +1           |
 * | Length ≥ 12                                             | +1           |
 * | Length ≥ 16                                             | +1           |
 * | Contains lowercase letter                               | +1           |
 * | Contains uppercase letter                               | +1           |
 * | Contains digit                                          | +1           |
 * | Contains symbol (anything outside `[A-Za-z0-9]`)        | +1           |
 * | Contains a common pattern (`123456`, `password`, …)     | −2           |
 * | Sequential repeats ≥ 4 (`aaaa`, `1111`, …)              | −2           |
 *
 * Buckets: `weak` (score ≤ 2), `fair` (3), `good` (4–5), `strong` (≥ 6).
 * The HaveIBeenPwned k-anonymity check from the design table is a
 * separate server-only concern (it requires a network call) and is not
 * part of this pure function.
 */

/** The four ratings emitted by `scorePassword()`. */
export type PasswordRating = 'weak' | 'fair' | 'good' | 'strong';

/** Stable, machine-readable identifiers for the dimensions evaluated. */
export type PasswordReasonCode =
  | 'too_short'
  | 'add_uppercase'
  | 'add_lowercase'
  | 'add_digit'
  | 'add_symbol'
  | 'add_length'
  | 'common_pattern'
  | 'sequential_repeat';

/** A single human-readable rationale paired with its stable code. */
export interface PasswordReason {
  /** Stable identifier suitable for translation lookup. */
  code: PasswordReasonCode;
  /** English fallback string. UI surfaces are expected to translate via `code`. */
  message: string;
}

/**
 * Detailed breakdown returned by `scorePasswordDetails()`.
 * `scorePassword()` returns just the `rating` to match the Task 49.6
 * signature contract.
 */
export interface PasswordScoreDetails {
  /** Raw integer score after applying contributions. Clamped to ≥ 0. */
  score: number;
  /** Bucketed rating used by both the meter and the server gate. */
  rating: PasswordRating;
  /** Plain-language rationale for the rating; safe to surface in UI. */
  reasons: PasswordReason[];
  /** Per-dimension flags so the UI rule checklist can render directly. */
  checks: {
    length8: boolean;
    length12: boolean;
    length16: boolean;
    lowercase: boolean;
    uppercase: boolean;
    digit: boolean;
    symbol: boolean;
    /** True when **no** common pattern was detected (i.e. this is a passing check). */
    notCommon: boolean;
    /** True when **no** ≥ 4-char sequential repeat was detected (passing check). */
    noSequentialRepeat: boolean;
  };
}

/**
 * Common-password block list. Sourced from the most-frequent leaks
 * (rockyou, SecLists "10-million-password-list-top-1000.txt") trimmed
 * to the patterns most likely to be tried against an EMIS account. The
 * list intentionally targets *substrings*: `Password123!` matches
 * because it contains `password`, which is what we want — anyone using
 * `Password123!` is using a leaked-template variant, not a strong
 * password.
 *
 * Comparisons are case-insensitive (the password is lowercased before
 * the substring check) so `PASSWORD`, `Password`, and `pAsSwOrD` all
 * match the `password` entry.
 */
const COMMON_PATTERNS: readonly string[] = Object.freeze([
  // Sequential numbers
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '654321',
  // Sequential keyboard rows
  'qwerty',
  'qwertyuiop',
  'asdfgh',
  'asdfghjkl',
  'zxcvbn',
  'zxcvbnm',
  '1qaz2wsx',
  // Common phrases
  'password',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'login',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'master',
  'shadow',
  'superman',
  'batman',
  'trustno1',
  // Sequential alphabet
  'abcdef',
  'abcdefg',
  'abcdefgh',
  // Common product / vendor names
  'proctira',
]);

/**
 * Detects four or more consecutive identical characters
 * (e.g. `aaaa`, `1111`). Implemented with a manual scan so the regex
 * engine doesn't have to manage Unicode property tables — this keeps
 * the function trivially pure and safe to call in hot paths.
 */
function hasSequentialRepeat(password: string, runLength = 4): boolean {
  if (password.length < runLength) return false;
  let runChar = password.charAt(0);
  let runCount = 1;
  for (let i = 1; i < password.length; i++) {
    const ch = password.charAt(i);
    if (ch === runChar) {
      runCount++;
      if (runCount >= runLength) return true;
    } else {
      runChar = ch;
      runCount = 1;
    }
  }
  return false;
}

/**
 * Returns the matching common-pattern entry (or `null`). The match is
 * case-insensitive and substring-based per the design.md §D contract.
 */
function findCommonPattern(password: string): string | null {
  const lower = password.toLowerCase();
  for (const pattern of COMMON_PATTERNS) {
    if (lower.includes(pattern)) return pattern;
  }
  return null;
}

/**
 * Compute the full scoring breakdown.
 *
 * Use `scorePasswordDetails()` when the caller needs the per-rule
 * satisfaction state (e.g. the `<PasswordStrengthMeter>` rule
 * checklist) or the human-readable `reasons[]`. Use `scorePassword()`
 * when the caller only needs the rating bucket (e.g. the server-side
 * "is this password acceptable?" check).
 */
export function scorePasswordDetails(password: string): PasswordScoreDetails {
  // An empty / non-string input is always `weak` with no positive
  // contributions. Returning a typed object instead of throwing keeps
  // the function safe to call from React render paths where the
  // password value is initially `''`.
  if (typeof password !== 'string' || password.length === 0) {
    return {
      score: 0,
      rating: 'weak',
      reasons: [{ code: 'too_short', message: 'Use at least 8 characters.' }],
      checks: {
        length8: false,
        length12: false,
        length16: false,
        lowercase: false,
        uppercase: false,
        digit: false,
        symbol: false,
        notCommon: true,
        noSequentialRepeat: true,
      },
    };
  }

  const checks = {
    length8: password.length >= 8,
    length12: password.length >= 12,
    length16: password.length >= 16,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
    notCommon: findCommonPattern(password) === null,
    noSequentialRepeat: !hasSequentialRepeat(password),
  };

  let score = 0;
  if (checks.length8) score += 1;
  if (checks.length12) score += 1;
  if (checks.length16) score += 1;
  if (checks.lowercase) score += 1;
  if (checks.uppercase) score += 1;
  if (checks.digit) score += 1;
  if (checks.symbol) score += 1;
  if (!checks.notCommon) score -= 2;
  if (!checks.noSequentialRepeat) score -= 2;
  if (score < 0) score = 0;

  const reasons: PasswordReason[] = [];
  if (!checks.length8) {
    reasons.push({ code: 'too_short', message: 'Use at least 8 characters.' });
  } else if (!checks.length12) {
    reasons.push({ code: 'add_length', message: 'Try a longer password (12+ characters).' });
  }
  if (!checks.lowercase) {
    reasons.push({ code: 'add_lowercase', message: 'Add a lowercase letter.' });
  }
  if (!checks.uppercase) {
    reasons.push({ code: 'add_uppercase', message: 'Add an uppercase letter.' });
  }
  if (!checks.digit) {
    reasons.push({ code: 'add_digit', message: 'Add a digit.' });
  }
  if (!checks.symbol) {
    reasons.push({ code: 'add_symbol', message: 'Add a symbol.' });
  }
  if (!checks.notCommon) {
    reasons.push({
      code: 'common_pattern',
      message: 'Avoid common passwords or predictable patterns.',
    });
  }
  if (!checks.noSequentialRepeat) {
    reasons.push({
      code: 'sequential_repeat',
      message: 'Avoid repeating the same character four or more times.',
    });
  }

  let rating: PasswordRating;
  if (score <= 2) rating = 'weak';
  else if (score === 3) rating = 'fair';
  else if (score <= 5) rating = 'good';
  else rating = 'strong';

  return { score, rating, reasons, checks };
}

/**
 * Score a password and return its bucketed rating.
 *
 * This is the canonical signature mandated by Task 49.6. Both the
 * `<PasswordStrengthMeter>` and the Auth Service's signup handler call
 * this function; rejecting `weak` passwords server-side guarantees
 * that an HTTP client bypassing the meter still cannot register a
 * trivially-guessable password (Requirement 4 AC 14).
 *
 * For richer feedback (per-rule checklist, plain-language reasons),
 * use `scorePasswordDetails()`.
 */
export function scorePassword(password: string): PasswordRating {
  return scorePasswordDetails(password).rating;
}
