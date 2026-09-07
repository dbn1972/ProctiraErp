# Agent instructions — ProctiraERP

## Enterprise skills (mandatory)

### Testing (Definition of Test)

For **full / E2E / enterprise / production-ready** module testing, read and obey:

`.cursor/skills/enterprise-module-production-ready/SKILL.md`

Checklist: `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`

### Development (Definition of Build)

For **implementing / closing product gaps / building** world-class modules (SIS schedule, gradebook, transcripts, board exports, timetable, etc.), read and obey:

`.cursor/skills/enterprise-module-development/SKILL.md`

Checklist: `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`

Plan of record for core SIS peer parity:

`docs/plans/SIS_WORLD_CLASS_10_GAP_CLOSURE.md`

### UX design review (Definition of Design Review)

For **UX / visual / IA / empty-state / mobile chrome** critique (not axe-only), read and obey:

`.cursor/skills/enterprise-ux-designer/SKILL.md`

Checklist: `docs/audits/templates/ENTERPRISE_UX_DESIGN_REVIEW.md`

**Rule:** Build with the development skill → certify with the testing skill → design-review with the UX designer skill when asked for UX sign-off. Do not claim product **10/10** on test evidence alone, “production-ready” on UI mocks alone, or “UX reviewed” from CI green / axe lists without viewing captures.

Hooks in `.cursor/hooks.json` enforce follow-ups for enterprise-test sessions until the test checklist evidence pack is complete.
