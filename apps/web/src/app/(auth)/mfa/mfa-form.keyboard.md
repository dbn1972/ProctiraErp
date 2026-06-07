# `<MfaForm>` (Code-Input) Keyboard Contract

Validates Task 56.6 / Requirement 37 AC 6.

`apps/web/src/app/(auth)/mfa/mfa-form.tsx` renders the six-digit
multi-factor authentication code-entry surface. Each digit is a
single-character `<input>`; the six inputs together form a logical
`role="group"` labelled "Verification code".

The contract below is exercised by `mfa-form.keyboard.test.tsx`.

## Initial focus

The first digit input is auto-focused on mount.

## Typing

| Key | Action |
| --- | --- |
| `0`–`9` | Sets the current digit, then **auto-advances** to the next slot. After typing into slot 6 the focus stays on slot 6 (no slot 7). |
| Any non-digit (letter, symbol) | Ignored (the input only stores digits 0–9). |

## Backspace

| Key | Action |
| --- | --- |
| `Backspace` (current slot is empty) | Move focus to the **previous** slot. |
| `Backspace` (current slot has a digit) | Clear that digit (default browser behaviour). Focus does not move yet — a subsequent `Backspace` will move to the previous slot. |

## Tab order

Each input is independently focusable in the natural document order.
`Tab` moves to the next slot, `Shift + Tab` to the previous. After
the sixth slot, `Tab` leaves the group and lands on the **Verify**
submit button.

## Paste

| Action | Behaviour |
| --- | --- |
| Pasting a 6-digit string (e.g., from a password manager / SMS auto-fill) into any slot | All six slots are filled in order. Focus moves to the last slot. |
| Pasting a string with non-digit characters mixed in | Non-digits are stripped; the first six remaining digits fill the slots. |
| Pasting fewer than 6 digits | The slots up to the paste length are filled; remaining slots stay empty. Focus moves to the slot after the last filled position. |

## Submit

| Key | Action |
| --- | --- |
| `Enter` (in any slot) | Submits the form. If the code is incomplete, the form shows the "code incomplete" inline error and keeps focus inside the group. |

## ARIA

- The wrapper is `<div role="group" aria-label="Verification code">`.
- Each input carries `aria-label="Digit {n}"` so each slot is named.
- The `inputMode="numeric"` and `autoComplete="one-time-code"`
  attributes hint to mobile keyboards and password managers.

## Source

- Implementation: `apps/web/src/app/(auth)/mfa/mfa-form.tsx`
- Tests: `apps/web/src/app/(auth)/mfa/mfa-form.keyboard.test.tsx`

[wai-aria-otp]: https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication.html
