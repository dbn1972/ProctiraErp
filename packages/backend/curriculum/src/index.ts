/**
 * @proctira/backend-curriculum — syllabus units, lesson plans, outcomes, coverage (G-923).
 *
 * Schema: db/sql/033_curriculum_schema.sql
 * Persistence: raw `pg` when DATABASE_URL is set; else in-memory.
 */

export { curriculumPlugin } from './plugin.js';
export type { CurriculumPluginOptions } from './plugin.js';
export { CurriculumService } from './service.js';
export type { CoverageSummary } from './service.js';
export { registerCurriculumRoutes } from './routes.js';
export type { CurriculumRoutesOptions } from './routes.js';
export { createCurriculumStore, isPgCurriculumEnabled } from './factory.js';
export {
  InMemoryCurriculumStore,
  PgCurriculumStore,
  type CurriculumStore,
  type SyllabusUnitRecord,
  type LessonPlanRecord,
  type LearningOutcomeRecord,
  type UnitCoverageRecord,
} from './store.js';
export {
  CreateSyllabusUnitSchema,
  CreateLessonPlanSchema,
  CreateLearningOutcomeSchema,
  MarkTaughtSchema,
} from './schemas.js';
