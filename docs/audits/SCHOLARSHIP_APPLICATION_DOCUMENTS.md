# Scholarship application documents

Supporting files for `POST /scholarships/applications` (income certificate, marksheet, caste/category certificate, ID proof, and other scheme types).

Storage reuses `@proctira/storage` (`S3_BUCKET` / `S3_ENDPOINT` MinIO or S3). With no bucket, bytes go to `SCHOLARSHIP_DOCUMENT_DIR` or the OS temp directory. No new storage product and no secrets in git. Download links are HMAC tokens (`SCHOLARSHIP_DOC_URL_SECRET` in production; a dev default otherwise) valid for 120 seconds, or a provider signed URL when the adapter can mint one.

There is no virus scanner in this repository. `ScholarshipDocumentService` accepts an optional `virusScan` hook and does not call a network scanner unless a caller injects one.

## Authz

| Caller                                          | Result                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Staff with scholarship permissions, same tenant | list, upload, delete; reviewers (`application.decide`) verify/reject |
| Parent/student linked to the applicant          | own draft only for upload/delete; read own application               |
| Other parent, same tenant                       | 403                                                                  |
| Other tenant                                    | 404 (application lookup is tenant-scoped)                            |

Submit of a draft fails with `Missing required documents: … Upload each file before submitting.` when the program's `eligibility.requiredDocuments` are absent or only present as `REJECTED`.

Audit rows (`entity_type = scholarship_application_document`, operations CREATE/UPDATE/DELETE) are written in the same Postgres transaction as the metadata change. The in-memory store records the same events for tests. File bytes are not copied into the audit payload.

## Residuals

| Item                                                        | Disposition                                                                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web applicant form `/scholarships/apply` and reviewer panel | implemented                                                                                                                                                                                             |
| Parent portal `(parent)/parent/*`                           | no scholarship apply route exists; not half-built                                                                                                                                                       |
| Flutter `ScholarshipApplicationScreen`                      | follow-up. The screen submits statement and income only. Do not add a partial picker until the mobile client can POST multipart to `/scholarships/applications/:id/documents` and show per-type errors. |
| Virus scan                                                  | hook only. No ClamAV client in the repo.                                                                                                                                                                |
| Live Postgres apply of `104` + Sunrise seed                 | run in an environment with Postgres; not claimed from unit tests alone                                                                                                                                  |
