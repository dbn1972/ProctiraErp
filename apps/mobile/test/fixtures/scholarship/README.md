Backend contract samples for PRC-H015, shaped exactly as the routes serialise
them at this commit:

- `staff_programs.json` — `GET /api/v1/scholarships/programs`
  (packages/backend/scholarship/src/routes.ts `listProgramsHandler`: spread of
  `ScholarshipProgramEntity` from scholarship-repository.ts + ISO dates).
- `parent_programs.json` — `GET /api/v1/parent-portal/scholarships/programs`
  (parent-scholarship-routes.ts).
- `staff_applications.json` — `GET /api/v1/scholarships/applications`
  (routes.ts `listApplicationsHandler`: spread of
  `ScholarshipApplicationEntity` + ISO dates).
- `parent_applications.json` — `GET /api/v1/parent-portal/scholarships/applications`.

Update these when the backend entity or route serialisation changes.
