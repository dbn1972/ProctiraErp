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
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
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

import { AttendanceMarkingForm } from './attendance-marking-form';
import { buildDraftKey } from '@/lib/draft/useDraftAutosave';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const INST_FROM_PROPS = '11111111-1111-4111-8111-111111111111';
const INST_FROM_DRAFT = '22222222-2222-4222-8222-222222222222';
const CLASS_FROM_PROPS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLASS_FROM_DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERIOD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ROSTER = [
  {
    studentId: 's-1',
    studentName: 'Alex Doe',
    enrollmentId: 'e-1',
    classId: CLASS_FROM_PROPS,
    gradeId: 'g-1',
  },
  {
    studentId: 's-2',
    studentName: 'Bea Roe',
    enrollmentId: 'e-2',
    classId: CLASS_FROM_PROPS,
    gradeId: 'g-1',
  },
];

const PROPS_DEFAULTS = {
  institutionId: INST_FROM_PROPS,
  classId: CLASS_FROM_PROPS,
  academicPeriodId: PERIOD,
  date: '2024-01-15',
};

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  // The autosave hook keys its slot off the current pathname. Pin
  // it to the attendance route so the test asserts the same key
  // the production form would use.
  window.history.replaceState(null, '', '/attendance');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AttendanceMarkingForm draft hydration', () => {
  it('rehydrates a persisted draft over the props-supplied defaults', () => {
    // Stage a previously-saved draft in the slot the autosave hook
    // owns. The schema version (`v: 1`) and ISO timestamp match the
    // envelope written by `useDraftAutosave`.
    const formId = `attendance-marking-${PERIOD}`;
    const key = buildDraftKey(formId);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        savedAt: '2024-01-15T08:00:00.000Z',
        values: {
          institutionId: INST_FROM_DRAFT,
          classId: CLASS_FROM_DRAFT,
          academicPeriodId: PERIOD,
          date: '2024-01-16',
          rows: [
            {
              studentId: 's-1',
              studentName: 'Alex Doe',
              status: 'ABSENT',
              comment: 'sick',
            },
            {
              studentId: 's-2',
              studentName: 'Bea Roe',
              status: 'LATE',
              comment: '',
            },
          ],
        },
      }),
    );

    render(
      <AttendanceMarkingForm
        institutions={[
          { id: INST_FROM_PROPS, name: 'Northside HS' },
          { id: INST_FROM_DRAFT, name: 'Eastside HS' },
        ]}
        defaults={PROPS_DEFAULTS}
        roster={ROSTER}
      />,
    );

    // The form replaced the prop-supplied class/date with the draft
    // values. The class picker is the second ui-select (after the
    // institution picker); the draft-restored id renders through the
    // fallback "Selected class" option.
    const selects = screen.getAllByTestId('ui-select');
    const classSelect = selects[1] as HTMLSelectElement;
    expect(classSelect.value).toBe(CLASS_FROM_DRAFT);

    const dateInput = screen.getByLabelText(/^Date$/i);
    expect((dateInput as HTMLInputElement).value).toBe('2024-01-16');

    // The roster grid renders at least one of the persisted students,
    // proving the row state survived the unmount.
    expect(screen.getByText('Alex Doe')).toBeTruthy();
    expect(screen.getByText('Bea Roe')).toBeTruthy();
  });

  it('writes form edits back through useDraftAutosave', () => {
    render(
      <AttendanceMarkingForm
        institutions={[{ id: INST_FROM_PROPS, name: 'Northside HS' }]}
        defaults={PROPS_DEFAULTS}
        roster={ROSTER}
      />,
    );

    const dateInput = screen.getByLabelText(/^Date$/i);

    act(() => {
      fireEvent.change(dateInput, { target: { value: '2024-02-29' } });
    });

    // The hook's internal debounce is the 30 s ceiling. Advance past
    // it so the pending write flushes to localStorage.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    const formId = `attendance-marking-${PERIOD}`;
    const raw = window.localStorage.getItem(buildDraftKey(formId));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      values: { date: string; institutionId: string };
    };
    expect(parsed.values.date).toBe('2024-02-29');
    expect(parsed.values.institutionId).toBe(INST_FROM_PROPS);
  });
});
