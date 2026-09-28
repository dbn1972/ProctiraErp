# Enterprise mobile Flutter checklist

**Slice:** Scholarship application document upload  
**Branch / tip:** `cursor/mobile-scholarship-documents-2d14`  
**Date (UTC):** 2026-09-28  
**Paired web audit (if any):** `docs/audits/SCHOLARSHIP_APPLICATION_DOCUMENTS.md` (staff web, PR #473). Parent web is a separate PR.

Copy of `docs/audits/templates/ENTERPRISE_MOBILE_FLUTTER_CHECKLIST.md`.

---

## 1. Surfaces

| Route / shell                                      | Staff / parent                                           | Notes                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scholarship apply (`ScholarshipApplicationScreen`) | Student / applicant using the existing scholarship shell | Per-type slots, photo, camera, and PDF/image file pick. Upload uses the same multipart contract as the web API (`asDraft`, then `POST …/applications/:id/documents`). |

## 2. Pillars

| Check                                     | Pass | Evidence                                                                                                                                                                                    |
| ----------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth login + Bearer + tenant header       | ☐    | Unchanged. Uploads go through the existing `Dio` client (`ScholarshipRepository`). No new token storage.                                                                                    |
| DI / repos registered for touched domains | ☐    | `ScholarshipRepository` is the existing registered repo. No new GetIt binding.                                                                                                              |
| `flutter analyze` clean                   | ☑    | 2026-09-28, Flutter 3.47.5: `flutter analyze` in `apps/mobile` reported no issues.                                                                                                          |
| Unit / golden tests for changed shells    | ☑    | 2026-09-28: `flutter test` in `apps/mobile` — 88 passed, including `scholarship_document_slots_test.dart` (per-type slots, progress, client error, upload error, semantics). No new golden. |
| Integration journey or dated waiver       | ☐    | Waiver 2026-09-28: no device or gateway-backed `integration_test` for this slice. Widget tests cover the slot states.                                                                       |
| Parent mode does not break staff shells   | ☐    | Parent portal screens were not edited.                                                                                                                                                      |
| Device-farm / real-device PNGs or waiver  | ☐    | Waiver 2026-09-28: no Android/iOS device farm in this environment. Linux widget tests are not device-farm evidence.                                                                         |
| No hardcoded tokens                       | ☐    | No tokens added.                                                                                                                                                                            |

## 3. Residuals / waivers

| Item                                                                                                                                                           | Owner  | Risk                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| Draft is created on the first successful upload and stores the personal statement at that moment. Later edits to the statement are not patched onto the draft. | Mobile | Applicant can edit the statement before the first upload.           |
| `institutionId` comes from `students_cache`. If the student row has no school id, upload fails with a visible error.                                           | Mobile | User must open the student list once so the cache is filled.        |
| Device-farm PNGs and an on-device upload journey are waived (2026-09-28).                                                                                      | Mobile | Camera and file-picker plugins are not exercised on a handset here. |
| This client is not mobile parity with the web reviewer queue (verify/reject stays on web).                                                                     | Mobile | Applicants upload; reviewers stay on the web queue.                 |
| Upload slots stay hidden until GET /api/v1/scholarships/document-downloads is a real route (401 or 400). A 404 keeps submit-without-files.                     | Mobile | After the document API ships, the same probe shows the slots.       |

## 4. Sign-off

**Native claim:** ☐ Ready w/ waivers

Not a claim of mobile parity with web, and not a device-farm pass.
