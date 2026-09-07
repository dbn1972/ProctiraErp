# Enterprise skills map — ProctiraERP

**Updated (UTC):** 2026-09-07  
**Purpose:** Index of agent skills for enterprise module delivery.

## Gate order

```text
product/IA → build → UX → a11y → security → mobile* → data/SQL* → test → release
```

| #   | Skill                   | Path                                                 | Checklist                                  |
| --- | ----------------------- | ---------------------------------------------------- | ------------------------------------------ |
| 1   | Product / IA            | `.cursor/skills/enterprise-product-ia/`              | `ENTERPRISE_PRODUCT_IA_CHECKLIST.md`       |
| 2   | Build                   | `.cursor/skills/enterprise-module-development/`      | `ENTERPRISE_MODULE_DEV_CHECKLIST.md`       |
| 3   | UX design               | `.cursor/skills/enterprise-ux-designer/`             | `ENTERPRISE_UX_DESIGN_REVIEW.md`           |
| 4   | Accessibility           | `.cursor/skills/enterprise-accessibility/`           | `ENTERPRISE_ACCESSIBILITY_CHECKLIST.md`    |
| 5   | Security & tenancy      | `.cursor/skills/enterprise-security-tenancy/`        | `ENTERPRISE_SECURITY_TENANCY_CHECKLIST.md` |
| 6   | Mobile Flutter          | `.cursor/skills/enterprise-mobile-flutter/`          | `ENTERPRISE_MOBILE_FLUTTER_CHECKLIST.md`   |
| 7   | Data / SQL              | `.cursor/skills/enterprise-data-sql-certification/`  | `ENTERPRISE_DATA_SQL_CHECKLIST.md`         |
| 8   | Test / production-ready | `.cursor/skills/enterprise-module-production-ready/` | `ENTERPRISE_MODULE_TEST_CHECKLIST.md`      |
| 9   | Release / ops           | `.cursor/skills/enterprise-release-ops/`             | `ENTERPRISE_RELEASE_OPS_CHECKLIST.md`      |

Templates live under `docs/audits/templates/`.

## When to run which

| Situation                 | Minimum skills                             |
| ------------------------- | ------------------------------------------ |
| New module                | 1 → 2 → 3 → 8 → 9 (+4/5/6/7 as applicable) |
| UX-only polish            | 3 (+4 if a11y)                             |
| Security-sensitive write  | 5 + 8                                      |
| Flutter parent/staff      | 6 + 8                                      |
| Schema / multi-board cert | 7 + 8                                      |
| Merge to main             | 9                                          |

## Related

- `AGENTS.md` — mandatory agent entrypoint
- `docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md` — scores
- Program hooks: `.cursor/hooks.json`
