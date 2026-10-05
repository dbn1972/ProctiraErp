import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../depth-actions', () => ({
  gradeWithRubricAction: vi.fn(),
  uploadLmsFileAction: vi.fn(),
}));

import { RubricGradeForm } from './depth-grade-forms';

describe('RubricGradeForm (PRC-M479)', () => {
  it('offers no free-points entry when no rubric is attached', () => {
    render(<RubricGradeForm assignmentId="a1" submissionId="s1" rubric={null} />);
    expect(screen.getByTestId('lms-rubric-missing')).toHaveTextContent('Attach a rubric');
    expect(screen.queryByLabelText('Points')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rubric grade' })).toBeDisabled();
  });
});
