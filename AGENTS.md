# Agent instructions — ProctiraERP

## Enterprise skills (mandatory)

Use skills as **decision gates**. Prefer one skill per gate — do not skip earlier gates when claiming later ones.

```text
product/IA → build → UX → a11y → security → mobile* → data/SQL* → test → release
* when the slice includes Flutter or certification-grade schema/seeds
```

### 1. Product / IA (Definition of Scope)

`.cursor/skills/enterprise-product-ia/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`

### 2. Development (Definition of Build)

`.cursor/skills/enterprise-module-development/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`  
SIS plan: `docs/plans/SIS_WORLD_CLASS_10_GAP_CLOSURE.md`

### 3. UX design review (Definition of Design Review)

`.cursor/skills/enterprise-ux-designer/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_UX_DESIGN_REVIEW.md`

### 4. Accessibility (Definition of A11y)

`.cursor/skills/enterprise-accessibility/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_ACCESSIBILITY_CHECKLIST.md`

### 5. Security & tenancy (Definition of Secure)

`.cursor/skills/enterprise-security-tenancy/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_SECURITY_TENANCY_CHECKLIST.md`

### 6. Mobile Flutter (Definition of Native) — when `apps/mobile` changes

`.cursor/skills/enterprise-mobile-flutter/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_MOBILE_FLUTTER_CHECKLIST.md`

### 7. Data / SQL certification (Definition of Data) — when schema/seeds certify

`.cursor/skills/enterprise-data-sql-certification/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md`

### 8. Testing (Definition of Test)

`.cursor/skills/enterprise-module-production-ready/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`

### 9. Release / ops (Definition of Ship)

`.cursor/skills/enterprise-release-ops/SKILL.md`  
Checklist: `docs/audits/templates/ENTERPRISE_RELEASE_OPS_CHECKLIST.md`

**Honesty rule:** Do not claim product **10/10** on test evidence alone, “production-ready” on UI mocks alone, “UX reviewed” without viewing captures, “secure” without cross-tenant proof, “mobile ready” from web PNGs alone, or “shipped” without tip CI on the merge commit (and main follow-up).

Hooks in `.cursor/hooks.json` enforce follow-ups for enterprise-test sessions until the test checklist evidence pack is complete.
