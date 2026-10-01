import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/assessments', () => ({
  listOutcomes: vi.fn(async () => []),
}));
vi.mock('@/lib/institutions/api', () => ({
  listSubjects: vi.fn(async () => [{ id: 'sub-1', code: 'MATH', name: 'Mathematics' }]),
}));
vi.mock('../_components/outcome-create-form', () => ({
  OutcomeCreateForm: () => <div data-testid="outcome-create-form" />,
}));

import AssessmentOutcomesPage from './page';

describe('AssessmentOutcomesPage copy (PRC-L028)', () => {
  it('does not claim outcomes can be attached to assessment items', async () => {
    render(await AssessmentOutcomesPage({}));
    expect(screen.queryByText(/attach them when you define/i)).toBeNull();
    expect(
      screen.getByText(/Linking outcomes to assessment items is not available yet/i),
    ).toBeTruthy();
  });
});
