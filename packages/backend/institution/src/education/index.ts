// Grade
export { GradeService } from './grade-service.js';
export type { GradeServiceDeps } from './grade-service.js';
export { registerGradeRoutes } from './grade-routes.js';
export type { GradeRoutesOptions } from './grade-routes.js';
export { CreateGradeSchema, UpdateGradeSchema, GradeResponseSchema } from './grade-schemas.js';
export type { CreateGradeDto, UpdateGradeDto, GradeResponse } from './grade-schemas.js';

// Class
export { ClassService } from './class-service.js';
export type { ClassServiceDeps } from './class-service.js';
export { registerClassRoutes } from './class-routes.js';
export type { ClassRoutesOptions } from './class-routes.js';
export { CreateClassSchema, UpdateClassSchema, ClassResponseSchema } from './class-schemas.js';
export type { CreateClassDto, UpdateClassDto, ClassResponse } from './class-schemas.js';

// Subject
export { SubjectService } from './subject-service.js';
export type { SubjectServiceDeps } from './subject-service.js';
export { registerSubjectRoutes } from './subject-routes.js';
export type { SubjectRoutesOptions } from './subject-routes.js';
export {
  CreateSubjectSchema,
  UpdateSubjectSchema,
  SubjectResponseSchema,
  LinkSubjectToGradeSchema,
  InstitutionSubjectResponseSchema,
} from './subject-schemas.js';
export type {
  CreateSubjectDto,
  UpdateSubjectDto,
  SubjectResponse,
  LinkSubjectToGradeDto,
  InstitutionSubjectResponse,
} from './subject-schemas.js';

// Active Period Validator
export { validateActivePeriod, ActivePeriodValidator } from './active-period-validator.js';
export type { ActivePeriodValidatorDeps } from './active-period-validator.js';
