/**
 * @vitest-environment node
 *
 * UATENV-D37: a substitution on an inactive or cancelled meeting is refused by
 * the gateway (400 VALIDATION_ERROR). The form showed the generic "could not be
 * saved" text, so the user could not tell why. It now gets fixed copy that
 * names the cause; the gateway text itself never reaches the browser (RAW-WEB).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayError } from '@/lib/api/gateway';

const createSubstitution = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/timetable', () => ({
  createSubstitution: (...a: unknown[]) => createSubstitution(...a),
}));

import { createSubstitutionAction } from './timetable-actions';

const input = {
  sectionMeetingId: 'meet-1',
  substituteStaffId: 'staff-2',
  substitutionDate: '2026-11-30',
  reason: null,
};

describe('createSubstitutionAction (UATENV-D37)', () => {
  afterEach(() => {
    createSubstitution.mockReset();
    vi.restoreAllMocks();
  });

  it('explains that the meeting slot is not active', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    createSubstitution.mockRejectedValue(
      new GatewayError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Cannot substitute an inactive or cancelled meeting',
        correlationId: 'corr-1234abcd',
      }),
    );
    const res = await createSubstitutionAction(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe(
      'This meeting slot is inactive or cancelled, so it cannot take a substitute. Choose an active slot. (ref corr-1234abcd)',
    );
    expect(res.status).toBe(400);
  });

  it('keeps the generic copy for other validation failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    createSubstitution.mockRejectedValue(
      new GatewayError({ status: 400, code: 'VALIDATION_ERROR', message: 'something else' }),
    );
    const res = await createSubstitutionAction(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/^The timetable change could not be saved\. \(ref /);
    expect(res.error).not.toContain('something else');
  });
});
