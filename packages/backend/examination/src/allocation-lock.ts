/**
 * W3-RACE-01 — serialise concurrent allocation ops (in-memory mutex; Pg uses
 * pg_advisory_xact_lock in the store guarded methods).
 */
export function createAllocationMutex() {
  const chains = new Map<string, Promise<void>>();

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    chains.set(key, previous.then(() => gate));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { run };
}

export function roomAllocationLockKey(tenantId: string, roomId: string, date: string): string {
  return `exam-room:${tenantId}:${roomId}:${date}`;
}

export function staffAllocationLockKey(tenantId: string, staffId: string, date: string): string {
  return `exam-staff:${tenantId}:${staffId}:${date}`;
}

export function seatingLockKey(tenantId: string, examinationId: string): string {
  return `exam-seating:${tenantId}:${examinationId}`;
}

/** Detect Postgres unique-violation (23505). */
export function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}
