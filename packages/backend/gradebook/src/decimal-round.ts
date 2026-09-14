/**
 * Deterministic decimal rounding for GPA / credit math (W3-D5).
 *
 * Avoids `Math.round(value * 10**n) / 10**n` float drift (e.g. 2.675 → 2.67).
 * Uses scaled BigInt arithmetic on decimal expansions derived from `toFixed`.
 */

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN';

const MAX_INPUT_DECIMALS = 12;

function assertPlaces(places: number): void {
  if (!Number.isInteger(places) || places < 0 || places > 15) {
    throw new RangeError('places must be an integer from 0 to 15');
  }
}

/** Scale a finite number to an integer with at most `maxDecimals` fractional digits. */
function toScaledInteger(value: number, maxDecimals: number): bigint {
  if (!Number.isFinite(value)) {
    throw new RangeError('value must be finite');
  }
  const negative = value < 0 || Object.is(value, -0);
  const raw = Math.abs(value).toFixed(maxDecimals);
  const [whole = '0', frac = ''] = raw.split('.');
  const digits = `${whole}${frac.padEnd(maxDecimals, '0')}`.replace(/^0+(?=\d)/, '');
  const bi = BigInt(digits || '0');
  return negative ? -bi : bi;
}

function roundScaledQuotient(
  numerator: bigint,
  denominator: bigint,
  places: number,
  mode: RoundingMode,
): bigint {
  if (denominator === 0n) {
    throw new RangeError('denominator must be non-zero');
  }

  const negative = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const scale = 10n ** BigInt(places);
  const scaledNum = absNum * scale;
  const quotient = scaledNum / absDen;
  const remainder = scaledNum % absDen;
  const twiceRemainder = remainder * 2n;

  let rounded = quotient;
  if (twiceRemainder > absDen) {
    rounded += 1n;
  } else if (twiceRemainder === absDen) {
    if (mode === 'HALF_UP') {
      rounded += 1n;
    } else if (quotient % 2n === 1n) {
      rounded += 1n;
    }
  }

  return negative ? -rounded : rounded;
}

function scaledQuotientToNumber(scaled: bigint, places: number): number {
  if (places === 0) return Number(scaled);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const str = abs.toString().padStart(places + 1, '0');
  const wholeLen = str.length - places;
  const whole = wholeLen > 0 ? str.slice(0, wholeLen) : '0';
  const frac = str.slice(wholeLen).padStart(places, '0');
  return (negative ? -1 : 1) * Number(`${whole}.${frac}`);
}

/**
 * Round `numerator / denominator` to `places` decimals without float drift.
 */
export function roundRatio(
  numerator: number,
  denominator: number,
  places: number,
  mode: RoundingMode = 'HALF_UP',
): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return NaN;
  if (denominator === 0) return NaN;
  assertPlaces(places);

  const numInt = toScaledInteger(numerator, MAX_INPUT_DECIMALS);
  const denInt = toScaledInteger(denominator, MAX_INPUT_DECIMALS);
  const rounded = roundScaledQuotient(numInt, denInt, places, mode);
  return scaledQuotientToNumber(rounded, places);
}

/**
 * Round a finite decimal to `places` using HALF_UP (default) or HALF_EVEN (banker's).
 */
export function roundDecimal(
  value: number,
  places: number,
  mode: RoundingMode = 'HALF_UP',
): number {
  if (!Number.isFinite(value)) return value;
  assertPlaces(places);
  if (value === 0) return 0;

  const rounded = roundScaledQuotient(
    toScaledInteger(value, MAX_INPUT_DECIMALS),
    10n ** BigInt(MAX_INPUT_DECIMALS),
    places,
    mode,
  );
  return scaledQuotientToNumber(rounded, places);
}
