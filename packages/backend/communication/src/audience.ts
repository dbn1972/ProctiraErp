/**
 * Deterministic audience size estimator for campaign preview (v1).
 * Real segment resolvers (enrollments / hostel / transport) plug in later.
 */

export interface AudiencePreviewResult {
  estimatedRecipients: number;
  scope: string;
  breakdown: Record<string, number>;
  honestyNote: string;
  source: 'estimator' | 'live';
}

const BASE_TENANT = 500;

export function estimateAudience(
  audienceJson: Record<string, unknown> = {},
  live?: { hostelActiveAssignments?: number | null; routeActiveAssignments?: number | null },
): AudiencePreviewResult {
  const scope = String(audienceJson['scope'] ?? 'all').toLowerCase();
  const breakdown: Record<string, number> = { base: BASE_TENANT };

  if (scope === 'hostel' && live?.hostelActiveAssignments != null) {
    return {
      estimatedRecipients: live.hostelActiveAssignments,
      scope,
      breakdown: { liveHostelAssignments: live.hostelActiveAssignments },
      honestyNote:
        'Live count from active hostel_assignments (guardians/channels not expanded yet).',
      source: 'live',
    };
  }

  if (scope === 'route' && live?.routeActiveAssignments != null) {
    return {
      estimatedRecipients: live.routeActiveAssignments,
      scope,
      breakdown: { liveRouteAssignments: live.routeActiveAssignments },
      honestyNote:
        'Live count from active transport_student_assignments (guardians/channels not expanded yet).',
      source: 'live',
    };
  }

  let estimated = BASE_TENANT;

  if (scope === 'grade') {
    const grade = String(audienceJson['grade'] ?? 'all');
    const factor = grade === 'all' ? 1 : 0.2;
    estimated = Math.max(1, Math.round(BASE_TENANT * factor));
    breakdown['gradeFactor'] = factor;
  } else if (scope === 'hostel') {
    estimated = Math.max(1, Math.round(BASE_TENANT * 0.15));
    breakdown['hostelShare'] = 0.15;
    if (audienceJson['hostelId']) breakdown['hostelBound'] = 1;
  } else if (scope === 'route') {
    estimated = Math.max(1, Math.round(BASE_TENANT * 0.08));
    breakdown['routeShare'] = 0.08;
    if (audienceJson['routeId']) breakdown['routeBound'] = 1;
  } else if (scope === 'custom') {
    const explicit = Number(audienceJson['estimatedRecipients']);
    estimated =
      Number.isFinite(explicit) && explicit >= 0
        ? Math.floor(explicit)
        : Math.round(BASE_TENANT * 0.5);
    breakdown['custom'] = estimated;
  }

  return {
    estimatedRecipients: estimated,
    scope,
    breakdown,
    honestyNote:
      'v1 estimator — not live enrollment counts. Wire student/hostel/route segment resolvers for production parity.',
    source: 'estimator',
  };
}
