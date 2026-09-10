# Product capability backlog (G-734)

Tracked absences from the capability matrix that are **not** in the current
enterprise wave. Each row is a future delivery item; DSAR export is the only
item implemented in-wave (audit + health PHI packages).

| ID     | Capability                             | Domain                | Priority | Status           | Notes                                                       |
| ------ | -------------------------------------- | --------------------- | -------- | ---------------- | ----------------------------------------------------------- |
| BL-001 | Student promotion / alumni progression | SIS                   | P1       | Backlog          | Year-end promote, alumni archive, transcript freeze         |
| BL-002 | Payroll / compensation runs            | HR / Finance          | P1       | Backlog          | Payslips, statutory deductions, bank file export            |
| BL-003 | Fee concessions / refunds / GL posting | Fees                  | P1       | Backlog          | Credit notes, refund workflow, double-entry GL              |
| BL-004 | Inventory / stores                     | Campus ops            | P2       | Backlog          | SKUs, stock movements, institution stores                   |
| BL-005 | E-sign / digital signatures            | Platform              | P2       | Backlog          | Consent forms, offer letters, policy acknowledgements       |
| BL-006 | DSAR export (data subject access)      | Privacy               | P0       | **Done (G-734)** | `GET /audit/dsar/:subjectId`, `GET /health/dsar/:studentId` |
| BL-007 | LMS / virtual classroom                | Academics             | P2       | Backlog          | Course shells, content, grade sync                          |
| BL-008 | Transport telematics                   | Transport             | P3       | Backlog          | Live GPS, geofence alerts                                   |
| BL-009 | Document OCR                           | Admissions / Registry | P3       | Backlog          | ID / certificate scan → structured fields                   |
| BL-010 | Surveys                                | Engagement            | —        | **Parked**       | See capability matrix PARKED note                           |
| BL-011 | Custom fields (tenant-defined)         | Platform              | —        | **Parked**       | Schema extension risk; revisit after G-735                  |

Parked items stay documented so they are not rediscovered as “missing” gaps
without an intentional reopen.
