# Cursor project config — ProctiraERP

## Mandatory skills for module testing

When the user asks for full / E2E / production-ready / enterprise testing of a redesign module (Scholarships, Health, etc.), agents **must** follow:

- `.cursor/skills/enterprise-module-production-ready/SKILL.md`
- Checklist: `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`

Project hooks (`.cursor/hooks.json`) arm an enterprise-test session and follow up on `stop` until evidence exists.

## What “done” means

Route smoke + green CI with skipped Playwright is **not** enterprise production-ready. Required pillars: functionality, live E2E where feasible, UX/a11y, multidevice screenshots, security/tenant/RBAC, CI gates, evidence pack.
