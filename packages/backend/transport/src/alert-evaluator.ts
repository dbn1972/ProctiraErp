/**
 * G-920 — transport alert evaluator (pure).
 *
 * Kinds:
 *  - delay_minutes: latest ping is later than scheduled departure + threshold minutes
 *  - geofence_exit: ping is farther than threshold metres from every stop on the route
 *  - missed_pickup: assigned student is still absent after scheduled pickup + threshold
 *
 * Unit-tested with synthetic pings/attendance — no GPS hardware.
 */
export type AlertKind = 'delay_minutes' | 'geofence_exit' | 'missed_pickup';

export interface EvaluatorPing {
  vehicleId: string;
  routeId: string | null;
  latitude: number;
  longitude: number;
  recordedAt: Date;
}

export interface EvaluatorStop {
  id: string;
  routeId: string;
  latitude: number | null;
  longitude: number | null;
  pickupTime: string | null;
}

export interface EvaluatorRule {
  id: string;
  kind: AlertKind;
  threshold: number;
  routeId: string | null;
  isActive: boolean;
}

export interface EvaluatorAttendance {
  studentId: string;
  routeId: string;
  status: 'boarded' | 'alighted' | 'absent';
  stopId: string | null;
}

export interface EvaluatorAssignment {
  studentId: string;
  routeId: string;
  stopId: string | null;
}

export interface EvaluateAlertsInput {
  now: Date;
  tripDate: string;
  pings: EvaluatorPing[];
  stops: EvaluatorStop[];
  rules: EvaluatorRule[];
  attendance: EvaluatorAttendance[];
  assignments: EvaluatorAssignment[];
  /** Route id → scheduled departure (HH:MM) on tripDate. */
  routeDeparture: Record<string, string | null>;
}

export interface AlertDraft {
  ruleId: string;
  kind: AlertKind;
  vehicleId: string | null;
  routeId: string | null;
  studentId: string | null;
  message: string;
  payload: Record<string, unknown>;
}

const EARTH_M = 6_371_000;

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function combineDateAndHm(isoDate: string, hm: string): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!match) return null;
  const hours = match[1];
  const minutes = match[2];
  if (!hours || !minutes) return null;
  const iso = `${isoDate}T${hours}:${minutes}:00.000Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function osmDeepLink(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

function ruleApplies(rule: EvaluatorRule, routeId: string | null): boolean {
  if (!rule.isActive) return false;
  if (!rule.routeId) return true;
  return routeId === rule.routeId;
}

export function evaluateTransportAlerts(input: EvaluateAlertsInput): AlertDraft[] {
  const drafts: AlertDraft[] = [];
  const active = input.rules.filter((r) => r.isActive);

  for (const ping of input.pings) {
    for (const rule of active) {
      if (!ruleApplies(rule, ping.routeId)) continue;

      if (rule.kind === 'delay_minutes' && ping.routeId) {
        const hm = input.routeDeparture[ping.routeId] ?? null;
        const scheduled = hm ? combineDateAndHm(input.tripDate, hm) : null;
        if (!scheduled) continue;
        const allowedMs = rule.threshold * 60_000;
        const lateMs = ping.recordedAt.getTime() - scheduled.getTime();
        if (lateMs > allowedMs) {
          drafts.push({
            ruleId: rule.id,
            kind: 'delay_minutes',
            vehicleId: ping.vehicleId,
            routeId: ping.routeId,
            studentId: null,
            message: `Vehicle delayed ${Math.round(lateMs / 60_000)} min (threshold ${rule.threshold})`,
            payload: { lateMinutes: Math.round(lateMs / 60_000), threshold: rule.threshold },
          });
        }
      }

      if (rule.kind === 'geofence_exit') {
        const routeStops = input.stops.filter(
          (s) =>
            (ping.routeId ? s.routeId === ping.routeId : true) &&
            s.latitude != null &&
            s.longitude != null &&
            (!rule.routeId || s.routeId === rule.routeId),
        );
        if (routeStops.length === 0) continue;
        const nearest = Math.min(
          ...routeStops.map((s) =>
            haversineMeters(ping, { latitude: s.latitude!, longitude: s.longitude! }),
          ),
        );
        if (nearest > rule.threshold) {
          drafts.push({
            ruleId: rule.id,
            kind: 'geofence_exit',
            vehicleId: ping.vehicleId,
            routeId: ping.routeId,
            studentId: null,
            message: `Vehicle ${Math.round(nearest)} m from nearest stop (geofence ${rule.threshold} m)`,
            payload: { nearestMeters: Math.round(nearest), threshold: rule.threshold },
          });
        }
      }
    }
  }

  for (const assignment of input.assignments) {
    for (const rule of active) {
      if (rule.kind !== 'missed_pickup') continue;
      if (!ruleApplies(rule, assignment.routeId)) continue;
      const row = input.attendance.find(
        (a) => a.studentId === assignment.studentId && a.routeId === assignment.routeId,
      );
      const status = row?.status ?? 'absent';
      if (status !== 'absent') continue;
      const stop = assignment.stopId
        ? input.stops.find((s) => s.id === assignment.stopId)
        : input.stops.find((s) => s.routeId === assignment.routeId);
      const hm = stop?.pickupTime ?? input.routeDeparture[assignment.routeId] ?? null;
      const scheduled = hm ? combineDateAndHm(input.tripDate, hm) : null;
      if (!scheduled) continue;
      const allowedMs = rule.threshold * 60_000;
      if (input.now.getTime() > scheduled.getTime() + allowedMs) {
        drafts.push({
          ruleId: rule.id,
          kind: 'missed_pickup',
          vehicleId: null,
          routeId: assignment.routeId,
          studentId: assignment.studentId,
          message: `Student missed pickup (absent after ${rule.threshold} min)`,
          payload: { threshold: rule.threshold, stopId: assignment.stopId },
        });
      }
    }
  }

  return drafts;
}
