/** G-921 gate-pass state machine and attendance identity. */

export type GatePassStatus = 'pending' | 'approved' | 'rejected' | 'out' | 'in';

export const GATE_PASS_TRANSITIONS: Record<GatePassStatus, readonly GatePassStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['out'],
  rejected: [],
  out: ['in'],
  in: [],
};

export function canTransitionGatePass(from: GatePassStatus, to: GatePassStatus): boolean {
  return GATE_PASS_TRANSITIONS[from].includes(to);
}

export function isOverdueReturn(
  status: GatePassStatus,
  expectedInAt: Date,
  now: Date = new Date(),
): boolean {
  return status === 'out' && expectedInAt.getTime() < now.getTime();
}

export function attendanceKey(blockId: string, studentId: string, onDate: string): string {
  return `${blockId}:${studentId}:${onDate}`;
}
