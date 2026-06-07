import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { MfaCodeInput, sanitizeOtp } from './MfaCodeInput';

/**
 * Validates Task 49.5 — `<MfaCodeInput>` implements the contract from
 * design.md §D: paste distribution, auto-advance, auto-retreat, arrow
 * navigation, the 48×48 touch-target rule, and per-box `aria-label`.
 */

interface ControlledProps {
  initial?: string;
  autoFocus?: boolean;
  onComplete?: (code: string) => void;
  onChange?: (code: string) => void;
}

function Controlled({
  initial = '',
  autoFocus = false,
  onComplete,
  onChange,
}: ControlledProps): React.ReactElement {
  const [code, setCode] = React.useState(initial);
  return (
    <MfaCodeInput
      value={code}
      onChange={(next) => {
        setCode(next);
        onChange?.(next);
      }}
      onComplete={onComplete}
      autoFocus={autoFocus}
      ariaLabel="Verification code"
    />
  );
}

function getCells(): HTMLInputElement[] {
  return Array.from({ length: 6 }, (_, i) =>
    screen.getByTestId(`mfa-code-input-cell-${i}`) as HTMLInputElement,
  );
}

describe('sanitizeOtp()', () => {
  it('strips non-digits and clamps to length', () => {
    expect(sanitizeOtp('1a2b3c4d5e6f7', 6)).toBe('123456');
    expect(sanitizeOtp('  9 8 7 ', 6)).toBe('987');
    expect(sanitizeOtp('abcdef', 6)).toBe('');
  });
});

describe('<MfaCodeInput />', () => {
  it('renders six inputs with the digit-of-six aria-label', () => {
    render(<Controlled />);
    const cells = getCells();
    expect(cells).toHaveLength(6);
    cells.forEach((cell, i) => {
      expect(cell).toHaveAttribute('aria-label', `Digit ${i + 1} of 6`);
      expect(cell).toHaveAttribute('inputMode', 'numeric');
      expect(cell).toHaveAttribute('autoComplete', 'one-time-code');
      expect(cell).toHaveAttribute('maxLength', '1');
    });
  });

  it('uses the supplied digitLabel for translated labels', () => {
    render(
      <MfaCodeInput
        value=""
        onChange={() => undefined}
        digitLabel={(n) => `Position ${n}`}
      />,
    );
    expect(
      screen.getByTestId('mfa-code-input-cell-0').getAttribute('aria-label'),
    ).toBe('Position 1');
  });

  it('applies a 48 px minimum touch target on every cell', () => {
    render(<Controlled />);
    const cells = getCells();
    cells.forEach((cell) => {
      // Tailwind `h-12` and `w-12` map to 48 px each (12 × 0.25rem ×
      // 16 px). Verifying the class names guards against the contract
      // changing without the test being updated alongside.
      expect(cell.className).toContain('h-12');
      expect(cell.className).toContain('w-12');
    });
  });

  it('auto-advances focus on character entry', () => {
    render(<Controlled autoFocus />);
    const [first, second, third] = getCells();

    expect(document.activeElement).toBe(first);
    fireEvent.change(first!, { target: { value: '1' } });
    expect(document.activeElement).toBe(second);
    fireEvent.change(second!, { target: { value: '2' } });
    expect(document.activeElement).toBe(third);
  });

  it('does not advance past the last cell when typing in cell 6', () => {
    render(<Controlled initial="12345" />);
    const cells = getCells();
    const last = cells[5]!;
    act(() => last.focus());
    fireEvent.change(last, { target: { value: '6' } });
    expect(document.activeElement).toBe(last);
  });

  it('auto-retreats on Backspace when the current input is empty', () => {
    render(<Controlled initial="12" />);
    const cells = getCells();
    const third = cells[2]!;
    act(() => third.focus());

    fireEvent.keyDown(third, { key: 'Backspace' });
    expect(document.activeElement).toBe(cells[1]);
    // The previous cell's value is cleared.
    expect(cells[1]!.value).toBe('');
  });

  it('clears the current cell on Backspace, truncating to the left', () => {
    render(<Controlled initial="123" />);
    const cells = getCells();
    const second = cells[1]!;
    act(() => second.focus());

    fireEvent.keyDown(second, { key: 'Backspace' });
    expect(document.activeElement).toBe(second);
    // Per the design.md contract, `value` stays left-aligned — clearing
    // cell 1 truncates everything from cell 1 onward.
    expect(second.value).toBe('');
    expect(cells[2]!.value).toBe('');
    // Cell 0 is untouched.
    expect(cells[0]!.value).toBe('1');
  });

  it('navigates with ArrowLeft and ArrowRight', () => {
    render(<Controlled initial="123456" />);
    const cells = getCells();
    const third = cells[2]!;
    act(() => third.focus());

    fireEvent.keyDown(third, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cells[1]);

    fireEvent.keyDown(cells[1]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[2]);
  });

  it('jumps to first/last with Home/End', () => {
    render(<Controlled initial="123456" />);
    const cells = getCells();
    act(() => cells[3]!.focus());

    fireEvent.keyDown(cells[3]!, { key: 'Home' });
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.keyDown(cells[0]!, { key: 'End' });
    expect(document.activeElement).toBe(cells[5]);
  });

  it('distributes a pasted 6-digit code across all cells and fires onComplete', () => {
    const onComplete = vi.fn();
    render(<Controlled onComplete={onComplete} autoFocus />);
    const cells = getCells();
    const first = cells[0]!;

    fireEvent.paste(first, {
      clipboardData: { getData: () => '987654' },
    });

    expect(cells.map((c) => c.value).join('')).toBe('987654');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('987654');
    // Focus parks on the last cell after a full paste.
    expect(document.activeElement).toBe(cells[5]);
  });

  it('strips non-digits when pasting a mixed-character string', () => {
    render(<Controlled autoFocus />);
    const cells = getCells();
    fireEvent.paste(cells[0]!, {
      clipboardData: { getData: () => '12-34 56  ' },
    });
    expect(cells.map((c) => c.value).join('')).toBe('123456');
  });

  it('paste always starts from cell 0 to keep the value left-aligned', () => {
    render(<Controlled />);
    const cells = getCells();
    act(() => cells[2]!.focus());

    fireEvent.paste(cells[2]!, {
      clipboardData: { getData: () => '78' },
    });

    // Even though cell 2 received the paste event, the contract treats
    // `value` as a gap-free string — distribute from cell 0.
    expect(cells[0]!.value).toBe('7');
    expect(cells[1]!.value).toBe('8');
    expect(cells[2]!.value).toBe('');
    expect(document.activeElement).toBe(cells[2]);
  });

  it('fires onComplete only when the full 6 digits are present', () => {
    const onComplete = vi.fn();
    render(<Controlled autoFocus onComplete={onComplete} />);
    const cells = getCells();

    for (let i = 0; i < 5; i += 1) {
      fireEvent.change(cells[i]!, { target: { value: String(i + 1) } });
    }
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.change(cells[5]!, { target: { value: '6' } });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('does not fire onComplete when pasting fewer than length digits', () => {
    const onComplete = vi.fn();
    render(<Controlled autoFocus onComplete={onComplete} />);
    fireEvent.paste(getCells()[0]!, {
      clipboardData: { getData: () => '123' },
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('disables every input when disabled is set', () => {
    render(
      <MfaCodeInput value="" onChange={() => undefined} disabled />,
    );
    getCells().forEach((cell) => expect(cell.disabled).toBe(true));
  });

  it('exposes the wrapper as a labelled group', () => {
    render(<Controlled />);
    const wrapper = screen.getByTestId('mfa-code-input');
    expect(wrapper.getAttribute('role')).toBe('group');
    expect(wrapper.getAttribute('aria-label')).toBe('Verification code');
  });
});
