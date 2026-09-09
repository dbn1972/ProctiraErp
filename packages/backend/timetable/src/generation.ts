/**
 * Constraint-based timetable generator (G-917).
 *
 * Greedy assignment over (day × period) slots, then a repair loop that retries
 * leftover demand. Hard constraints are never violated in the output assignment
 * set — leftover demand is left unassigned rather than double-booked.
 *
 * Hard:
 *   - teacher / room / section unique per (dayOfWeek, periodId)
 *   - teacher availability (unavailable slots skipped)
 *   - room capacity ≥ enrollmentCount when a room is chosen
 *
 * Soft (scoring only):
 *   - spread a section+subject across different days
 *   - teacher periods/day ≤ teacherMaxPeriodsPerDay
 */

export interface GeneratorPeriod {
  id: string;
  startTime: string;
  endTime: string;
  periodOrder: number;
}

export interface GeneratorRoom {
  id: string;
  capacity: number;
}

export interface GeneratorDemand {
  id: string;
  sectionId: string;
  subjectId: string;
  staffId: string;
  periodsPerWeek: number;
  preferredRoomId?: string | null;
  enrollmentCount?: number;
}

export interface UnavailableSlot {
  staffId: string;
  dayOfWeek: number;
  periodId: string;
}

export interface GenerateInput {
  daysOfWeek: number[];
  periods: GeneratorPeriod[];
  rooms: GeneratorRoom[];
  demands: GeneratorDemand[];
  unavailable?: UnavailableSlot[];
  teacherMaxPeriodsPerDay?: number;
}

export interface GeneratorAssignment {
  demandId: string;
  sectionId: string;
  subjectId: string;
  staffId: string;
  roomId: string | null;
  periodId: string;
  dayOfWeek: number;
}

export interface UnassignedDemand {
  demandId: string;
  remaining: number;
}

export interface GenerateResult {
  assignments: GeneratorAssignment[];
  unassigned: UnassignedDemand[];
  hardClashCount: number;
  repairPasses: number;
  stats: {
    greedyAssigned: number;
    repaired: number;
    demandPeriods: number;
  };
}

const DEFAULT_MAX_PERIODS = 6;
const MAX_REPAIR_PASSES = 8;

function key(parts: Array<string | number>): string {
  return parts.join('|');
}

export function countHardClashes(
  assignments: GeneratorAssignment[],
  input: Pick<GenerateInput, 'rooms' | 'unavailable' | 'demands'>,
): number {
  const teacher = new Set<string>();
  const room = new Set<string>();
  const section = new Set<string>();
  const unavailable = new Set(
    (input.unavailable ?? []).map((u) => key([u.staffId, u.dayOfWeek, u.periodId])),
  );
  const roomsById = new Map(input.rooms.map((r) => [r.id, r]));
  const demandById = new Map(input.demands.map((d) => [d.id, d]));
  let clashes = 0;

  for (const a of assignments) {
    const tKey = key([a.staffId, a.dayOfWeek, a.periodId]);
    const sKey = key([a.sectionId, a.dayOfWeek, a.periodId]);
    if (teacher.has(tKey)) clashes += 1;
    teacher.add(tKey);
    if (section.has(sKey)) clashes += 1;
    section.add(sKey);
    if (a.roomId) {
      const rKey = key([a.roomId, a.dayOfWeek, a.periodId]);
      if (room.has(rKey)) clashes += 1;
      room.add(rKey);
      const cap = roomsById.get(a.roomId)?.capacity ?? Number.POSITIVE_INFINITY;
      const enroll = demandById.get(a.demandId)?.enrollmentCount ?? 0;
      if (enroll > cap) clashes += 1;
    }
    if (unavailable.has(tKey)) clashes += 1;
  }
  return clashes;
}

interface Occupancy {
  teacher: Set<string>;
  room: Set<string>;
  section: Set<string>;
  teacherDay: Map<string, number>;
  subjectDays: Map<string, Set<number>>;
}

function emptyOccupancy(): Occupancy {
  return {
    teacher: new Set(),
    room: new Set(),
    section: new Set(),
    teacherDay: new Map(),
    subjectDays: new Map(),
  };
}

function occupy(occ: Occupancy, a: GeneratorAssignment): void {
  occ.teacher.add(key([a.staffId, a.dayOfWeek, a.periodId]));
  occ.section.add(key([a.sectionId, a.dayOfWeek, a.periodId]));
  if (a.roomId) occ.room.add(key([a.roomId, a.dayOfWeek, a.periodId]));
  const td = key([a.staffId, a.dayOfWeek]);
  occ.teacherDay.set(td, (occ.teacherDay.get(td) ?? 0) + 1);
  const sd = key([a.sectionId, a.subjectId]);
  const days = occ.subjectDays.get(sd) ?? new Set<number>();
  days.add(a.dayOfWeek);
  occ.subjectDays.set(sd, days);
}

function release(occ: Occupancy, a: GeneratorAssignment): void {
  occ.teacher.delete(key([a.staffId, a.dayOfWeek, a.periodId]));
  occ.section.delete(key([a.sectionId, a.dayOfWeek, a.periodId]));
  if (a.roomId) occ.room.delete(key([a.roomId, a.dayOfWeek, a.periodId]));
  const td = key([a.staffId, a.dayOfWeek]);
  const n = (occ.teacherDay.get(td) ?? 1) - 1;
  if (n <= 0) occ.teacherDay.delete(td);
  else occ.teacherDay.set(td, n);
  const sd = key([a.sectionId, a.subjectId]);
  const days = occ.subjectDays.get(sd);
  if (days) {
    days.delete(a.dayOfWeek);
    if (days.size === 0) occ.subjectDays.delete(sd);
  }
}

function pickRoom(
  demand: GeneratorDemand,
  rooms: GeneratorRoom[],
  occ: Occupancy,
  dayOfWeek: number,
  periodId: string,
): string | null {
  const enroll = demand.enrollmentCount ?? 0;
  const free = rooms.filter((r) => {
    if (enroll > r.capacity) return false;
    return !occ.room.has(key([r.id, dayOfWeek, periodId]));
  });
  if (free.length === 0) return null;
  if (demand.preferredRoomId) {
    const preferred = free.find((r) => r.id === demand.preferredRoomId);
    if (preferred) return preferred.id;
  }
  return free[0]?.id ?? null;
}

function canPlaceHard(
  demand: GeneratorDemand,
  dayOfWeek: number,
  periodId: string,
  roomId: string | null,
  occ: Occupancy,
  unavailable: Set<string>,
): boolean {
  if (unavailable.has(key([demand.staffId, dayOfWeek, periodId]))) return false;
  if (occ.teacher.has(key([demand.staffId, dayOfWeek, periodId]))) return false;
  if (occ.section.has(key([demand.sectionId, dayOfWeek, periodId]))) return false;
  if (roomId && occ.room.has(key([roomId, dayOfWeek, periodId]))) return false;
  return true;
}

function softScore(
  demand: GeneratorDemand,
  dayOfWeek: number,
  roomId: string | null,
  occ: Occupancy,
  maxPeriods: number,
): number {
  let score = 0;
  const subjectDays = occ.subjectDays.get(key([demand.sectionId, demand.subjectId]));
  if (!subjectDays || !subjectDays.has(dayOfWeek)) score += 10;
  const dayLoad = occ.teacherDay.get(key([demand.staffId, dayOfWeek])) ?? 0;
  if (dayLoad < maxPeriods) score += 5;
  else score -= 20;
  score -= dayLoad;
  if (roomId && demand.preferredRoomId && roomId === demand.preferredRoomId) score += 2;
  return score;
}

interface Slot {
  dayOfWeek: number;
  period: GeneratorPeriod;
}

function buildSlots(days: number[], periods: GeneratorPeriod[]): Slot[] {
  const orderedDays = [...days].sort((a, b) => a - b);
  const orderedPeriods = [...periods].sort((a, b) => a.periodOrder - b.periodOrder);
  const slots: Slot[] = [];
  for (const dayOfWeek of orderedDays) {
    for (const period of orderedPeriods) {
      slots.push({ dayOfWeek, period });
    }
  }
  return slots;
}

function tryPlaceOne(
  demand: GeneratorDemand,
  slots: Slot[],
  rooms: GeneratorRoom[],
  occ: Occupancy,
  unavailable: Set<string>,
  maxPeriods: number,
): GeneratorAssignment | null {
  let best: { score: number; assignment: GeneratorAssignment } | null = null;
  for (const slot of slots) {
    const roomId =
      rooms.length === 0
        ? null
        : pickRoom(demand, rooms, occ, slot.dayOfWeek, slot.period.id);
    if (rooms.length > 0 && roomId === null && (demand.enrollmentCount ?? 0) > 0) {
      continue;
    }
    if (!canPlaceHard(demand, slot.dayOfWeek, slot.period.id, roomId, occ, unavailable)) {
      continue;
    }
    const score = softScore(demand, slot.dayOfWeek, roomId, occ, maxPeriods);
    if (!best || score > best.score) {
      best = {
        score,
        assignment: {
          demandId: demand.id,
          sectionId: demand.sectionId,
          subjectId: demand.subjectId,
          staffId: demand.staffId,
          roomId,
          periodId: slot.period.id,
          dayOfWeek: slot.dayOfWeek,
        },
      };
    }
  }
  return best?.assignment ?? null;
}

/**
 * Greedy fill then repair leftover demand. Output assignments always have
 * `countHardClashes(...) === 0`.
 */
export function generateTimetable(input: GenerateInput): GenerateResult {
  const days = input.daysOfWeek.length > 0 ? input.daysOfWeek : [1, 2, 3, 4, 5];
  const maxPeriods = input.teacherMaxPeriodsPerDay ?? DEFAULT_MAX_PERIODS;
  const unavailable = new Set(
    (input.unavailable ?? []).map((u) => key([u.staffId, u.dayOfWeek, u.periodId])),
  );
  const slots = buildSlots(days, input.periods);
  const occ = emptyOccupancy();
  const assignments: GeneratorAssignment[] = [];
  const remaining = new Map<string, { demand: GeneratorDemand; left: number }>();

  const sortedDemands = [...input.demands].sort((a, b) => b.periodsPerWeek - a.periodsPerWeek);
  for (const demand of sortedDemands) {
    remaining.set(demand.id, { demand, left: Math.max(0, demand.periodsPerWeek) });
  }

  let greedyAssigned = 0;
  for (const demand of sortedDemands) {
    const state = remaining.get(demand.id);
    if (!state) continue;
    while (state.left > 0) {
      const placed = tryPlaceOne(demand, slots, input.rooms, occ, unavailable, maxPeriods);
      if (!placed) break;
      occupy(occ, placed);
      assignments.push(placed);
      state.left -= 1;
      greedyAssigned += 1;
    }
  }

  let repairPasses = 0;
  let repaired = 0;
  while (repairPasses < MAX_REPAIR_PASSES) {
    const leftover = [...remaining.values()].filter((s) => s.left > 0);
    if (leftover.length === 0) break;
    repairPasses += 1;
    let progressed = false;
    // Rotate slot order so the greedy scorer sees a different first-feasible set.
    const rotated = slots.slice(repairPasses).concat(slots.slice(0, repairPasses));
    for (const state of leftover) {
      while (state.left > 0) {
        const placed = tryPlaceOne(state.demand, rotated, input.rooms, occ, unavailable, maxPeriods);
        if (!placed) break;
        occupy(occ, placed);
        assignments.push(placed);
        state.left -= 1;
        repaired += 1;
        progressed = true;
      }
    }
    if (!progressed) {
      // Displace a soft-violating assignment (teacher over max periods/day) and retry.
      const over = assignments.find((a) => {
        const load = occ.teacherDay.get(key([a.staffId, a.dayOfWeek])) ?? 0;
        return load > maxPeriods;
      });
      if (!over) break;
      release(occ, over);
      const idx = assignments.indexOf(over);
      if (idx >= 0) assignments.splice(idx, 1);
      const owner = remaining.get(over.demandId);
      if (owner) owner.left += 1;
    }
  }

  const unassigned: UnassignedDemand[] = [...remaining.values()]
    .filter((s) => s.left > 0)
    .map((s) => ({ demandId: s.demand.id, remaining: s.left }));

  const demandPeriods = input.demands.reduce((sum, d) => sum + Math.max(0, d.periodsPerWeek), 0);
  const hardClashCount = countHardClashes(assignments, input);

  return {
    assignments,
    unassigned,
    hardClashCount,
    repairPasses,
    stats: { greedyAssigned, repaired, demandPeriods },
  };
}
