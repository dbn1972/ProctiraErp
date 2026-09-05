# Redesign catalog audit — done vs not done

Generated from `redesign/index.html` SCREENS vs shipped apps.

**Totals:** 124 screens — **DONE 117**, **PARTIAL 6**, **NOT_DONE 1**


## Web App — Auth

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Login | /login — AuthShell + LoginForm |
| **DONE** | Sign up | /signup — AuthShell + SignUpForm |
| **DONE** | Forgot password | /forgot-password — Auth page shipped |
| **DONE** | Reset password | /reset-password — Auth page shipped |
| **DONE** | MFA verification | /mfa — Auth page shipped |

## Web App — Overview & People

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Dashboard | /home  |
| **DONE** | Students · list | /students  |
| **DONE** | Students · profile | /students/[id]  |
| **DONE** | Students · add | /students/new  |
| **DONE** | Students · edit | /students/[id]/edit  |
| **DONE** | Students · bulk import | /students/import  |
| **DONE** | Students · transfer | /students/[id]/transfer  |
| **DONE** | Staff · list | /staff  |
| **DONE** | Staff · profile | /staff/[id]  |
| **DONE** | Staff · add | /staff/new  |
| **DONE** | Staff · edit | /staff/[id]/edit  |
| **DONE** | Staff · new assignment | /staff/[id]/assignments/new  |
| **DONE** | Staff · new appraisal | /staff/[id]/appraisals/new  |

## Web App — Academics

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Institutions · list | /institutions  |
| **DONE** | Institutions · profile | /institutions/[id]→overview — Redirects to overview tab |
| **DONE** | Institutions · overview tab | /institutions/[id]/overview  |
| **DONE** | Institutions · register | /institutions/new  |
| **DONE** | Institutions · edit | /institutions/[id]/edit  |
| **DONE** | Institutions · classes | /institutions/[id]/classes  |
| **DONE** | Institutions · grades | /institutions/[id]/grades  |
| **DONE** | Institutions · infrastructure | /institutions/[id]/infrastructure  |
| **DONE** | Academic periods | /academic-periods  |
| **DONE** | Attendance · mark | /attendance  |
| **PARTIAL** | Attendance · reports | /attendance/reports — Thin UI vs redesign |
| **DONE** | Assessments · schemes | /assessments  |
| **DONE** | Assessments · items | /assessments/items  |
| **DONE** | Assessments · new scheme | /assessments/schemes/new  |
| **DONE** | Assessments · edit scheme | /assessments/schemes/[id]/edit  |
| **DONE** | Assessments · result entry | /assessments/results  |
| **DONE** | Examinations · list | /examinations  |
| **DONE** | Examinations · schedule | /examinations/new  |
| **DONE** | Examinations · detail | /examinations/[id]  |
| **DONE** | Examinations · candidates | /examinations/[id]/candidates  |
| **DONE** | Examinations · documents | /examinations/[id]/documents  |
| **DONE** | Examinations · results | /examinations/[id]/results  |

## Web App — Services

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Scholarships · programs | /scholarships  |
| **DONE** | Scholarships · program detail | /scholarships/programs/[id]  |
| **DONE** | Scholarships · new program | /scholarships/programs/new  |
| **DONE** | Scholarships · applications | /scholarships/applications  |
| **DONE** | Scholarships · application detail | /scholarships/applications/[id]  |
| **DONE** | Scholarships · disbursements | /scholarships/disbursements  |
| **DONE** | Health · screenings | /health  |
| **DONE** | Health · student profile | /health/[studentId]  |
| **DONE** | Health · counselling | /health/counselling  |
| **DONE** | Health · special needs | /health/special-needs  |
| **DONE** | Workflows · definitions | /workflows  |
| **DONE** | Workflows · new definition | /workflows/definitions/new  |
| **DONE** | Workflows · definition detail | /workflows/definitions/[id]  |
| **DONE** | Workflows · instances | /workflows/instances  |
| **DONE** | Workflows · my approvals | /workflows/approvals  |

## Web App — Insights & System

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Reports · catalog | /reports  |
| **DONE** | Reports · builder | /reports/new  |
| **DONE** | Reports · result | /reports/[id]/results  |
| **DONE** | Data warehouse · overview | /data-warehouse  |
| **DONE** | Data warehouse · import | /data-warehouse/import  |
| **DONE** | Data warehouse · field mapping | /data-warehouse/map  |
| **DONE** | Admin · overview | /admin  |
| **DONE** | Admin · users | /admin/users  |
| **DONE** | Admin · roles | /admin/roles  |
| **PARTIAL** | Admin · permission matrix | /admin/policies — Policies page; not full permission matrix UI |
| **NOT_DONE** | Admin · tenant settings | — — No dedicated tenant settings page in web app |
| **DONE** | Public · track application | /track  |

## Platform Admin Console

| Status | Screen | Route / note |
|--------|--------|--------------|
| **PARTIAL** | Operator login | — — apps/admin-console exists; login route TBD |
| **DONE** | Platform overview | /  |
| **DONE** | Tenants | /tenants  |
| **DONE** | Provision tenant | /tenants/new  |
| **DONE** | Plans | /plans  |
| **DONE** | Plugins | /plugins  |
| **DONE** | Themes | /themes  |
| **DONE** | Break-glass | /break-glass  |
| **DONE** | Break-glass requests | /break-glass/requests  |
| **DONE** | Support | /support  |
| **DONE** | System health | /health  |
| **DONE** | Audit log | /audit  |
| **PARTIAL** | 403 Forbidden | — — Likely middleware; no dedicated mock page needed |

## Registration Portal

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Home | /register  |
| **DONE** | Find schools | /register/schools  |
| **DONE** | Apply · personal info | /register/apply  |
| **DONE** | Apply · documents | /register/apply (+ registration-portal docs step)  |
| **DONE** | Apply · review | /register/apply (+ registration-portal review)  |
| **DONE** | Apply · success | /register/success  |
| **DONE** | Track application | /track  |

## Public Website

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Home | / — Marketing LandingPage |
| **DONE** | Product | /features  |
| **DONE** | Installation | /installation  |
| **DONE** | Security | /security  |
| **DONE** | Compliance | /security/compliance  |
| **DONE** | Status | /status  |
| **DONE** | About | /about — features/marketing/AboutPage |
| **DONE** | Contact | /contact  |
| **DONE** | Legal hub | /legal  |
| **DONE** | Privacy | /legal/privacy  |
| **DONE** | Terms | /legal/terms  |
| **DONE** | Cookies | /legal/cookies  |

## Other Portals

| Status | Screen | Route / note |
|--------|--------|--------------|
| **PARTIAL** | Developer portal | — — apps/developer-portal thin single page |
| **PARTIAL** | Install wizard | — — apps/install-wizard thin single page |

## Mobile App (native)

| Status | Screen | Route / note |
|--------|--------|--------------|
| **DONE** | Login (biometric) | — — Flutter features/auth/presentation/login_screen.dart |
| **DONE** | Choose workspace | — — Flutter features/tenant/presentation/tenant_selection_screen.dart |
| **DONE** | Home | — — Flutter features/home/presentation/home_screen.dart |
| **DONE** | Notifications | — — Flutter features/notifications/presentation/notifications_screen.dart |
| **DONE** | Students | — — Flutter features/students/presentation/students_screen.dart |
| **DONE** | Student profile | — — Flutter features/students/presentation/student_profile_screen.dart |
| **DONE** | Enrollment history | — — Flutter features/students/presentation/enrollment_history_screen.dart |
| **DONE** | Attendance (geofence) | — — Flutter features/attendance/presentation/attendance_screen.dart |
| **DONE** | Services hub | — — Flutter features/home/presentation/services_screen.dart |
| **DONE** | Marks entry | — — Flutter features/assessment/presentation/assessment_results_screen.dart |
| **DONE** | Examinations | — — Flutter features/examination/presentation/examination_list_screen.dart |
| **DONE** | Exam results | — — Flutter features/examination/presentation/examination_results_screen.dart |
| **DONE** | Scholarship programs | — — Flutter features/scholarship/presentation/scholarship_programs_screen.dart |
| **DONE** | Scholarship apply | — — Flutter features/scholarship/presentation/scholarship_application_screen.dart |
| **DONE** | Scholarship status | — — Flutter features/scholarship/presentation/scholarship_status_screen.dart |
| **DONE** | Health records | — — Flutter features/health/presentation/health_records_screen.dart |
| **DONE** | Document scan | — — Flutter features/students/presentation/document_capture_screen.dart |
| **DONE** | Institutions | — — Flutter features/institutions/presentation/institutions_screen.dart |
| **DONE** | Institution detail | — — Flutter features/institutions/presentation/institution_detail_screen.dart |
| **DONE** | Reports | — — Flutter features/reports/presentation/reports_screen.dart |
| **DONE** | Report detail | — — Flutter features/reports/presentation/report_detail_screen.dart |
| **DONE** | Profile & settings | — — Flutter features/profile/presentation/profile_screen.dart |
| **DONE** | Notification prefs | — — Flutter features/notifications/presentation/notification_preferences_screen.dart |

### Legend
- **DONE** — Shipped page/screen with real UI (may still differ visually from redesign mock)
- **PARTIAL** — Exists but thin, redirect-only wrapper without body, or incomplete vs redesign
- **NOT_DONE** — No matching shipped route/app screen

### Note on §5 modules
Finance, Timetable, Library, Hostel, Inventory, Canteen, Payroll, Alumni, LMS are **shipped in the web app** but **not listed** in the redesign sidebar catalog.
