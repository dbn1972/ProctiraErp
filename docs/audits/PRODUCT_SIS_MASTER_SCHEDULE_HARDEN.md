# Product / IA — SIS Master schedule harden

**Module / slice:** Master schedule RBAC · cross-tenant · publish audit  
**Branch:** `cursor/sis-master-schedule-harden-56c3`  
**Date (UTC):** 2026-09-07

## Capability

Registrar/scheduler can write schedule + publish sections; teachers cannot; Tenant B cannot see Tenant A sections; publish/unpublish leaves an audit trail.

## Scope

| In                           | Out               |
| ---------------------------- | ----------------- |
| RBAC on write/publish routes | Live IdP E2E      |
| Cross-tenant unit proof      | Student-picker UX |
| Publish audit                | Device-farm       |

## DoD

- [x] Unit tests green (access + isolation + audit)
- [ ] Tip CI + merge
