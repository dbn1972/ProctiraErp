/**
 * PRC-L035 — exam section navigation is a nav of links, not an ARIA tablist.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/examinations/exam-1/candidates',
}));

import { ExamTabs } from './exam-tabs';

describe('ExamTabs (PRC-L035)', () => {
  it('renders links with aria-current and no tab roles', () => {
    const { container } = render(<ExamTabs examId="exam-1" candidateCount={3} />);
    expect(screen.getByRole('navigation', { name: 'Examination sections' })).toBeTruthy();
    expect(container.querySelector('[role="tablist"], [role="tab"], [aria-selected]')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Candidates');
  });
});
