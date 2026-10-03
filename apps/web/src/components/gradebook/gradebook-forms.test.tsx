/**
 * PRC-M473: grade entry carries no invented assessment / credit-rule defaults and the
 * action rejects out-of-range or non-numeric scores before any gateway call.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ upsertGradeEntry: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gradebook', () => api);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { upsertGradeEntryAction } from '@/app/(dashboard)/gradebook-actions';
import { GradeEntryForm } from './gradebook-forms';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());

describe('GradeEntryForm defaults (PRC-M473)', () => {
  it('starts with an empty assessment code and no credit rule preselected', () => {
    render(
      <GradeEntryForm
        institutionId={ID}
        sectionId={ID}
        creditRuleOptions={[{ code: 'CR-1', name: 'Core' }]}
      />,
    );
    expect(screen.getByLabelText('Assessment / course code')).toHaveValue('');
    expect(screen.getByLabelText('Credit rule')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'CR-1 · Core' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('CBSE-CORE');
    expect(document.body.innerHTML).not.toContain('MATH');
  });
});

describe('upsertGradeEntryAction score validation (PRC-M473)', () => {
  it.each([101, Number.NaN, -1])('rejects numericScore=%s without a gateway call', async (score) => {
    const r = await upsertGradeEntryAction({ studentId: ID, numericScore: score });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(api.upsertGradeEntry).not.toHaveBeenCalled();
  });
});
