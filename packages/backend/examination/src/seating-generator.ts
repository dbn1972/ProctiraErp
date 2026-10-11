/**
 * In-memory seating allocation used by document-generation tests:
 * 30 seats per room, seat numbers S01…S30, rooms numbered from 1 per centre.
 * G-908 persists this plan rather than inventing a different layout.
 */

export const SEATS_PER_ROOM = 30;

export interface SeatingCandidate {
  candidateId: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  centerId: string;
  centerName: string;
  subjectNames: string[];
}

export interface GeneratedSeat {
  candidateId: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  centerId: string;
  centerName: string;
  roomNumber: string;
  seatNumber: string;
  subjectNames: string[];
}

function seatLabel(indexInRoom: number): string {
  return `S${String(indexInRoom + 1).padStart(2, '0')}`;
}

export function generateSeatingPlan(
  candidates: SeatingCandidate[],
  seatsPerRoom: number = SEATS_PER_ROOM,
): GeneratedSeat[] {
  const perRoom = Math.max(1, seatsPerRoom);
  const byCenter = new Map<string, SeatingCandidate[]>();
  for (const candidate of candidates) {
    const list = byCenter.get(candidate.centerId) ?? [];
    list.push(candidate);
    byCenter.set(candidate.centerId, list);
  }

  const seats: GeneratedSeat[] = [];
  for (const group of byCenter.values()) {
    // PRC-M242: order candidates by roll number using natural numeric ordering
    // so R2 precedes R10 (plain localeCompare sorts "R10" before "R2"). This
    // keeps adjacent seats in true roll-number sequence.
    const ordered = [...group].sort((a, b) =>
      a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true, sensitivity: 'base' }),
    );
    ordered.forEach((candidate, index) => {
      seats.push({
        candidateId: candidate.candidateId,
        studentId: candidate.studentId,
        studentName: candidate.studentName,
        rollNumber: candidate.rollNumber,
        centerId: candidate.centerId,
        centerName: candidate.centerName,
        roomNumber: `Room ${Math.floor(index / perRoom) + 1}`,
        seatNumber: seatLabel(index % perRoom),
        subjectNames: [...candidate.subjectNames],
      });
    });
  }
  return seats;
}
