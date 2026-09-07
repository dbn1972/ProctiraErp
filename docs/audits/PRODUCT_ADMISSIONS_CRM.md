# Product / IA — Admissions CRM depth

**Module / slice:** Waitlist + interview slots (beyond apply/track)  
**Branch:** `cursor/admissions-crm-depth-56c3`  
**Date (UTC):** 2026-09-07

## Capability

Staff can list applications, set status (incl. waitlisted → waitlist queue), create interview slots, and book applicants into slots with capacity enforcement. Public status returns waitlist position + bookings. OCR / live apply portal waived.

## Scope

| In                          | Out                                                    |
| --------------------------- | ------------------------------------------------------ |
| CRM APIs + `/admissions` UI | OCR / document AI                                      |
| SQL `014_*` schema doc      | Full PG application migration (in-memory CRM store v1) |
| Unit waitlist + capacity    | Live IdP                                               |

## DoD

- [x] Unit CRM test green
- [ ] Tip CI + merge
