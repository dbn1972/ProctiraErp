import { describe, expect, it } from 'vitest';
import { counsellingStatusPresentation, isUpcomingCounsellingSession } from './counselling-status';

describe('PRC-M476 counselling status', () => {
  it('renders No-show explicitly', () => {
    expect(counsellingStatusPresentation('NO_SHOW').label).toBe('No-show');
    expect(counsellingStatusPresentation('no-show').label).toBe('No-show');
  });

  it('shows an unknown status as-is rather than Scheduled', () => {
    expect(counsellingStatusPresentation('RESCHEDULED').label).toBe('RESCHEDULED');
  });

  it('excludes past scheduled sessions from Upcoming', () => {
    const today = '2025-06-10';
    expect(
      isUpcomingCounsellingSession({ status: 'SCHEDULED', sessionDate: '2025-06-01' }, today),
    ).toBe(false);
    expect(
      isUpcomingCounsellingSession(
        { status: 'SCHEDULED', sessionDate: '2025-06-10T09:00:00Z' },
        today,
      ),
    ).toBe(true);
    expect(
      isUpcomingCounsellingSession({ status: 'COMPLETED', sessionDate: '2025-07-01' }, today),
    ).toBe(false);
  });
});
