'use client';

import * as React from 'react';
import { flushSync } from 'react-dom';

import { cn } from './lib/utils';

/**
 * `<MfaCodeInput>` — shared 6-digit one-time-code control.
 *
 * Six single-character inputs the user types or pastes a TOTP into. The
 * widget is purely presentational: callers own the assembled string via
 * `value` / `onChange` and react to completion through `onComplete`. Used
 * by `<MFAVerify>` (Task 49.5) and any future surface that needs a
 * one-time code (e.g., backup-code prompt, device-pairing flow).
 *
 * Behaviors implemented from design.md §D — `<MfaCodeInput>` contract:
 *
 *   1. Six single-character boxes rendered with `inputMode="numeric"`,
 *      `pattern="[0-9]*"`, `maxLength={1}`, `autoComplete="one-time-code"`.
 *   2. Paste handler captures `onPaste`, extracts the first 6 numeric
 *      characters from `clipboardData.getData('text')`, distributes one
 *      digit per box, and fires `onComplete` if the result has 6 digits.
 *   3. Auto-advance — typing a digit moves focus to the next box.
 *   4. Auto-retreat — pressing Backspace in an empty box moves focus to
 *      the previous box; pressing Backspace in a non-empty box clears
 *      the current box.
 *   5. Arrow-key navigation — Left/Right arrows move focus across boxes.
 *   6. Each box has an `aria-label` such as "Digit 3 of 6".
 *   7. Visible focus ring of at least 2 px (Requirement 37 AC 5).
 *   8. Mirrors state — the parent receives the joined code string via
 *      `onChange` on every keystroke.
 *   9. Each box satisfies the 48×48 px touch-target rule (Requirement
 *      37 AC 3).
 *
 * The component is locale-agnostic: the `aria-label` template defaults to
 * English (`"Digit {n} of 6"`) and can be overridden via `digitLabel(n)`
 * so callers integrated with `useLanguage()` can supply the translated
 * string.
 */

const DEFAULT_LENGTH = 6;
const ONLY_DIGITS = /\D/g;

export interface MfaCodeInputProps {
  /** Always 6 for TOTP. Configurable so other length codes can reuse the widget. */
  length?: number;
  /** The current code string. Length 0..length. */
  value: string;
  /** Receives the joined code on every keystroke / paste. */
  onChange: (code: string) => void;
  /** Fires when `length` digits have been entered. */
  onComplete?: (code: string) => void;
  /** Disables every input box. */
  disabled?: boolean;
  /** Focus the first input on mount. */
  autoFocus?: boolean;
  /** Group label (announced once when the user enters the widget). */
  ariaLabel?: string;
  /**
   * Returns the per-box `aria-label` (`Digit {n} of 6`). Allows callers
   * to inject a translated string from `useLanguage().t()`.
   */
  digitLabel?: (n: number, total: number) => string;
  /** id forwarded to the wrapper for `aria-describedby` chaining. */
  id?: string;
  /** Outer wrapper class. */
  className?: string;
  /** `data-testid` for the wrapper. Defaults to `mfa-code-input`. */
  ['data-testid']?: string;
}

function defaultDigitLabel(n: number, total: number): string {
  return `Digit ${n} of ${total}`;
}

/** Strips everything that isn't a digit and clamps to `length`. */
export function sanitizeOtp(input: string, length: number): string {
  return input.replace(ONLY_DIGITS, '').slice(0, length);
}

/**
 * Builds a length-`length` array of single characters. Empty slots are
 * rendered as the empty string so the controlled input stays empty.
 */
function spread(value: string, length: number): string[] {
  const cells = new Array<string>(length).fill('');
  for (let i = 0; i < Math.min(value.length, length); i += 1) {
    cells[i] = value[i] ?? '';
  }
  return cells;
}

export const MfaCodeInput = React.forwardRef<HTMLDivElement, MfaCodeInputProps>(
  function MfaCodeInput(
    {
      length = DEFAULT_LENGTH,
      value,
      onChange,
      onComplete,
      disabled = false,
      autoFocus = false,
      ariaLabel,
      digitLabel = defaultDigitLabel,
      id,
      className,
      'data-testid': testId = 'mfa-code-input',
    },
    ref,
  ) {
    const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);
    // Mirror the controlled `value` synchronously so rapid keystrokes
    // (e.g. Playwright `keyboard.type('12')`) read the latest code
    // before React re-renders.
    const valueRef = React.useRef(value);
    valueRef.current = value;
    const cells = spread(sanitizeOtp(value, length), length);

    // Focus the first slot on mount when `autoFocus` is requested. We
    // rely on a ref rather than the native `autoFocus` attribute so the
    // browser doesn't fight us when the widget mounts inside a modal.
    React.useEffect(() => {
      if (autoFocus && inputsRef.current[0]) {
        inputsRef.current[0].focus();
      }
      // Run once on mount; intentionally omit deps.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function focusInput(index: number): void {
      const target = inputsRef.current[index];
      if (target) {
        target.focus();
        target.select();
      }
    }

    function emit(next: string): void {
      const sanitized = sanitizeOtp(next, length);
      valueRef.current = sanitized;
      flushSync(() => {
        onChange(sanitized);
      });
      if (sanitized.length === length && onComplete) {
        onComplete(sanitized);
      }
    }

    function insertDigit(digit: string, index: number): void {
      const currentValue = valueRef.current;
      const shouldAppend =
        index >= currentValue.length ||
        (index === currentValue.length - 1 &&
          cells[index] !== '' &&
          currentValue.length < length);
      const nextValue = shouldAppend
        ? currentValue + digit
        : currentValue.slice(0, index) + digit;
      emit(nextValue);
      focusInput(Math.min(nextValue.length, length - 1));
    }

    function handleChange(
      event: React.ChangeEvent<HTMLInputElement>,
      index: number,
    ): void {
      const raw = event.target.value;
      const currentValue = valueRef.current;
      // The browser may deliver multiple characters at once (autofill,
      // IME, mobile suggestions). Treat that as a paste-like operation.
      const digits = sanitizeOtp(raw, length);
      if (digits.length === 0) {
        // The user emptied the slot. Truncate the code so it stays
        // left-aligned (the design.md contract treats `value` as a
        // gap-free string, length 0..6).
        emit(currentValue.slice(0, index));
        return;
      }

      if (digits.length === 1) {
        insertDigit(digits, index);
        return;
      }

      // Multi-character input (autofill / SMS one-time-code suggestion).
      // Distribute starting from cell 0 so the OTP stays left-aligned —
      // the only case the design contract guarantees.
      emit(digits);
      const nextFocus = Math.min(digits.length, length - 1);
      focusInput(nextFocus);
    }

    function handleKeyDown(
      event: React.KeyboardEvent<HTMLInputElement>,
      index: number,
    ): void {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        insertDigit(event.key, index);
        return;
      }

      switch (event.key) {
        case 'Backspace': {
          const currentValue = valueRef.current;
          if (cells[index]) {
            // Clear the current cell. Stays focused so the user can
            // type a replacement digit immediately. We truncate the
            // value to keep it left-aligned (the contract treats
            // `value` as gap-free).
            event.preventDefault();
            emit(currentValue.slice(0, index));
            return;
          }
          // Empty cell — retreat to the previous slot and clear it.
          if (index > 0) {
            event.preventDefault();
            emit(currentValue.slice(0, index - 1));
            focusInput(index - 1);
          }
          return;
        }
        case 'ArrowLeft': {
          if (index > 0) {
            event.preventDefault();
            focusInput(index - 1);
          }
          return;
        }
        case 'ArrowRight': {
          if (index < length - 1) {
            event.preventDefault();
            focusInput(index + 1);
          }
          return;
        }
        case 'Home': {
          event.preventDefault();
          focusInput(0);
          return;
        }
        case 'End': {
          event.preventDefault();
          focusInput(length - 1);
          return;
        }
        default:
          return;
      }
    }

    function handlePaste(
      event: React.ClipboardEvent<HTMLInputElement>,
      _index: number,
    ): void {
      const raw = event.clipboardData.getData('text');
      const digits = sanitizeOtp(raw, length);
      if (digits.length === 0) return;

      // The contract guarantees a left-aligned, gap-free `value`. We
      // therefore start the paste at index 0 regardless of which cell
      // received the event — pasting the full code is the dominant
      // expected behaviour and matches every popular OTP widget
      // (Apple/iOS one-time-code autofill, shadcn `input-otp`, …).
      event.preventDefault();
      emit(digits);
      const nextFocus = Math.min(digits.length, length - 1);
      focusInput(nextFocus);
    }

    function handleFocus(event: React.FocusEvent<HTMLInputElement>): void {
      // Select the existing digit so typing replaces it instead of
      // appending. Browsers may prepend a stale digit otherwise.
      event.target.select();
    }

    return (
      <div
        ref={ref}
        id={id}
        role="group"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-2',
          disabled && 'opacity-60',
          className,
        )}
        data-testid={testId}
      >
        {cells.map((cell, index) => (
          <input
            key={index}
            ref={(node) => {
              inputsRef.current[index] = node;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            autoFocus={autoFocus && index === 0}
            disabled={disabled}
            value={cell}
            aria-label={digitLabel(index + 1, length)}
            data-testid={`${testId}-cell-${index}`}
            onChange={(event) => handleChange(event, index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onPaste={(event) => handlePaste(event, index)}
            onFocus={handleFocus}
            // 48×48 px minimum touch target (Requirement 37 AC 3). The
            // visible border is rendered with a 2 px focus ring (AC 5).
            className={cn(
              'h-12 w-12 rounded-md border border-input bg-background text-center text-lg font-semibold tabular-nums shadow-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
        ))}
      </div>
    );
  },
);
