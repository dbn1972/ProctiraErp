import { describe, expect, it } from 'vitest';

import { waitlistApplicantLabel } from './waitlist-label';

const applications = [
  {
    id: 'app-1',
    firstName: 'Asha',
    lastName: 'Rao',
    trackingNumber: 'APP-1042',
  },
];

describe('waitlistApplicantLabel', () => {
  it('shows the applicant name and application number', () => {
    expect(waitlistApplicantLabel('app-1', applications)).toBe('Asha Rao · APP-1042');
  });

  it('does not fall back to a truncated application id', () => {
    expect(waitlistApplicantLabel('33333333-3333-4333-8333-333333333333', applications)).toBe(
      'Unknown applicant',
    );
  });
});
