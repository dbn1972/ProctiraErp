# School ERP specs index (token-cheap)

Single entry point. **Do not duplicate** phase bodies here — link only.

## Locked architecture
- One Postgres, **schema per domain**, bare UUID across boundaries.
- Charter: service ownership; no cross-service SQL joins/FKs.

## Phase contracts (source of truth)
| Phase | Spec / evidence |
|-------|-----------------|
| 2 Auth | [PHASE_2_AUTH_SIGNOFF.md](../PHASE_2_AUTH_SIGNOFF.md) |
| 3 Institution | [PHASE_3_INSTITUTION_SIGNOFF.md](../PHASE_3_INSTITUTION_SIGNOFF.md) |
| 4 Student | [PHASE_4_STUDENT_SIGNOFF.md](../PHASE_4_STUDENT_SIGNOFF.md) |
| 5 Attendance | [PHASE_5_ATTENDANCE_SIGNOFF.md](../PHASE_5_ATTENDANCE_SIGNOFF.md) |
| 6 Assessment | [PHASE_6_ASSESSMENT_SIGNOFF.md](../PHASE_6_ASSESSMENT_SIGNOFF.md) |

## Runbooks (ops detail on demand)
- [docs/runbooks/](../runbooks/)

## UI references
- [redesign/](../../redesign/) — prefer over inventing layouts.

## Validate scripts
- `tools/scripts/validate-phase2-auth-ec3.sh`
- `tools/scripts/validate-phase3-institution-ec3.sh`
- `tools/scripts/validate-phase4-5-student-attendance-ec3.sh`
- `tools/scripts/validate-phase6-assessment-ec3.sh`

## Token policy for agents
1. Start from this index.
2. Open **one** phase sign-off or **one** runbook.
3. Skip re-reading completed phases unless the change crosses their boundary.
