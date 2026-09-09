import type { AttendanceHeatmapSource } from './service.js';

let bound: AttendanceHeatmapSource | undefined;

/** Gateway binds attendance after that plugin mounts (separate Fastify scope). */
export function bindAttendanceHeatmapSource(source: AttendanceHeatmapSource): void {
  bound = source;
}

export function getBoundAttendanceHeatmapSource(): AttendanceHeatmapSource | undefined {
  return bound;
}
