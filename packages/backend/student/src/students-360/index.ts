export { Students360Service, decodePhotoPayload } from './service.js';
export type { AttendanceHeatmapSource, Students360ServiceDeps } from './service.js';
export { registerStudents360Routes } from './routes.js';
export type { Students360RoutesOptions } from './routes.js';
export { InMemoryStudents360Store, PgStudents360Store } from './store.js';
export type { Students360Store } from './store.js';
export { createStudents360Store } from './create-store.js';
export { bindAttendanceHeatmapSource } from './attendance-bridge.js';
export {
  InMemoryStudentBlobStore,
  LocalDiskStudentBlobStore,
  createStudentBlobStore,
} from './blob-store.js';
export type { StudentBlobStore } from './blob-store.js';
export { aggregateAttendanceHeatmap, defaultHeatmapRange } from './heatmap.js';
export { renderStudentIdCardPdf } from './id-card-pdf.js';
