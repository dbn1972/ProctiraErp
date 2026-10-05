/**
 * @vitest-environment jsdom
 *
 * AttendanceMarkingForm draft-hydration integration test
 * (Task 60.5, Requirement 38 AC 5, 38 AC 8, Design §I)
 * =====================================================================
 *
 * Verifies the end-to-end wiring between `useDraftAutosave` and the
 * <AttendanceMarkingForm> client component:
 *
 *   1. A persisted draft in `localStorage` (the slot key the hook
 *      builds at the form's route) is rehydrated into the form on
 *      mount, replacing the props-supplied selection (institution,
 *      class, academic period, date) and roster row state.
 *
 *   2. Edits to the live form are written back through the hook so
 *      partial work survives a remount (i.e. `localStorage` carries
 *      the latest snapshot once the autosave debounce fires).
 *
 * The test lives at the component boundary on purpose: it is the
 * cheapest way to prove that wrapping the long-running attendance
 * form with `useDraftAutosave()` actually persists and restores
 * across a full unmount/remount cycle, which is what Requirement 38
 * AC 8 promises to a clerk who closes their browser mid-marking.
 *
 * Server-only collaborators (server actions, the `next/navigation`
 * router) are stubbed so the component renders inside jsdom without
 * pulling in the Next runtime.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import React from 'react';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// `markAttendanceAction` is a server action; the integration test
// never submits the form, but the import would otherwise resolve to
// a server-only file when vitest tries to load it. Mocking it keeps
// the module graph synchronous and side-effect-free.
vi.mock('../actions', () => ({
  markAttendanceAction: vi.fn(),
}));

// Mock the shared shadcn/ui primitives down to plain HTML so the
// test does not have to render Radix portals. The forwarded props
// (id, value, onChange, disabled, role, aria-*) are preserved so the
// test can interact with the component the same way a user would.
vi.mock('@proctira/ui/components', () => {
  const Pass = ({
    children,
    ...rest
  }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  );
  const Button = ({
    children,
    onClick,
    type = 'button',
    disabled,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  );
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />;
  const Label = ({ children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...rest}>{children}</label>
  );

  // Lightweight Radix-Select replacement: emits a native <select> so
  // the test can drive `change` events directly. The form passes a
  // <SelectTrigger>/<SelectValue> trigger node alongside the option
  // <SelectContent> children — we only render the latter so the
  // generated DOM stays a clean <select><option/></select>.
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    const items = React.Children.toArray(children).filter((child): child is React.ReactElement => {
      if (!React.isValidElement(child)) return false;
      // Keep only <SelectContent> (and anything nested under it).
      return (child.type as { displayName?: string }).displayName === 'SelectContent';
    });
    return (
      <select
        data-testid="ui-select"
        value={value ?? ''}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {items}
      </select>
    );
  }
  const SelectContent = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  SelectContent.displayName = 'SelectContent';
  const SelectGroup = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const SelectItem = ({
    children,
    value,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    disabled?: boolean;
  }) => (
    <option value={value} disabled={disabled}>
      {children}
    </option>
  );
  const SelectTrigger = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const SelectValue = ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>;

  // Plain semantic table primitives are sufficient for jsdom.
  const Table = ({ children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) => (
    <table {...rest}>{children}</table>
  );
  const TableHeader = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />;
  const TableBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
  const TableRow = (p: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...p} />;
  const TableHead = (p: React.ThHTMLAttributes<HTMLTableCellElement>) => <th {...p} />;
  const TableCell = (p: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...p} />;

  return {
    Button,
    Input,
    Label,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Card: Pass,
    CardContent: Pass,
    CardHeader: Pass,
    CardTitle: Pass,
    CardDescription: Pass,
  };
});

// `lucide-react` ships ESM with named icon exports — render a simple
// stub so the bundle does not pull in real icons.
vi.mock('lucide-react', () => ({
  Save: () => null,
  CheckCheck: () => null,
}));

// ─── Subject under test ──────────────────────────────────────────────────────

import { AttendanceMarkingForm, attendanceDraftFormId } from './attendance-marking-form';
import { buildDraftKey, purgeAllDrafts } from '@/lib/draft/useDraftAutosave';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const INST = '11111111-1111-4111-8111-111111111111';
const CLASS_10A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLASS_10B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERIOD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SCOPE_A = 'tenant-1:user-a';
const SCOPE_B = 'tenant-1:user-b';
const DATE = '2024-01-15';

const ROSTER = [
  {
    studentId: 's-1',
    studentName: 'Alex Doe',
    enrollmentId: 'e-1',
    classId: CLASS_10A,
    gradeId: 'g-1',
  },
  {
    studentId: 's-2',
    studentName: 'Bea Roe',
    enrollmentId: 'e-2',
    classId: CLASS_10A,
    gradeId: 'g-1',
  },
  // Added to the roster after the draft was saved.
  {
    studentId: 's-3',
    studentName: 'Cy New',
    enrollmentId: 'e-3',
    classId: CLASS_10A,
    gradeId: 'g-1',
  },
];

const defaultsFor = (classId: string) => ({
  institutionId: INST,
  classId,
  academicPeriodId: PERIOD,
  date: DATE,
});

function keyFor(classId: string, scope: string) {
  return buildDraftKey(attendanceDraftFormId(defaultsFor(classId))!, scope);
}

function stageDraft(classId: string, scope: string, savedAt = new Date().toISOString()) {
  window.localStorage.setItem(
    keyFor(classId, scope),
    JSON.stringify({
      v: 1,
      savedAt,
      values: { rows: [{ studentId: 's-1', status: 'ABSENT' }] },
    }),
  );
}

function renderForm(classId: string, scope?: string) {
  return render(
    <AttendanceMarkingForm
      institutions={[{ id: INST, name: 'Northside HS' }]}
      defaults={defaultsFor(classId)}
      roster={ROSTER}
      draftScope={scope}
    />,
  );
}

function statusOf(name: string): string | null {
  const group = screen.getByRole('group', { name: `Attendance status for ${name}` });
  const pressed = within(group)
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'true');
  return pressed?.textContent ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/attendance');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AttendanceMarkingForm draft (PRC-M079 / PRC-M080)', () => {
  it('offers a found draft via explicit prompt and merges it onto the current roster', () => {
    stageDraft(CLASS_10A, SCOPE_A);
    renderForm(CLASS_10A, SCOPE_A);

    // Not applied until the user chooses.
    expect(screen.getByTestId('attendance-draft-prompt')).toBeTruthy();
    expect(statusOf('Alex Doe')).toBe('Present');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
    });
    expect(statusOf('Alex Doe')).toBe('Absent');
    // A student added after the draft was saved still shows.
    expect(screen.getByText('Cy New')).toBeTruthy();
    expect(screen.getByTestId('attendance-draft-applied')).toBeTruthy();
  });

  it('does not restore a draft written by another user', () => {
    stageDraft(CLASS_10A, SCOPE_A);
    renderForm(CLASS_10A, SCOPE_B);
    expect(screen.queryByTestId('attendance-draft-prompt')).toBeNull();
  });

  it('a draft for 10A does not affect 10B', () => {
    stageDraft(CLASS_10A, SCOPE_A);
    renderForm(CLASS_10B, SCOPE_A);
    expect(screen.queryByTestId('attendance-draft-prompt')).toBeNull();
  });

  it('discards drafts older than the TTL', () => {
    stageDraft(CLASS_10A, SCOPE_A, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    renderForm(CLASS_10A, SCOPE_A);
    expect(screen.queryByTestId('attendance-draft-prompt')).toBeNull();
    expect(window.localStorage.getItem(keyFor(CLASS_10A, SCOPE_A))).toBeNull();
  });

  it('persists only studentId/status under the scoped key after an edit', () => {
    renderForm(CLASS_10A, SCOPE_A);
    act(() => {
      const group = screen.getByRole('group', { name: 'Attendance status for Bea Roe' });
      fireEvent.click(within(group).getByRole('button', { name: 'Late' }));
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    const raw = window.localStorage.getItem(keyFor(CLASS_10A, SCOPE_A));
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('Bea Roe');
    const parsed = JSON.parse(raw!) as { values: { rows: Array<Record<string, string>> } };
    expect(parsed.values.rows).toContainEqual({ studentId: 's-2', status: 'LATE' });
    expect(Object.keys(parsed.values.rows[0]!).sort()).toEqual(['status', 'studentId']);
  });

  it('never writes a draft without a user scope', () => {
    renderForm(CLASS_10A, undefined);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all present' }));
      vi.advanceTimersByTime(30_000);
    });
    expect(window.localStorage.length).toBe(0);
  });

  it('purgeAllDrafts (logout) removes every draft', () => {
    stageDraft(CLASS_10A, SCOPE_A);
    window.localStorage.setItem('unrelated', 'keep');
    purgeAllDrafts();
    expect(window.localStorage.getItem(keyFor(CLASS_10A, SCOPE_A))).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });
});
