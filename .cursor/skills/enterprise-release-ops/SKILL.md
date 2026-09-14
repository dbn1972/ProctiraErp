---
name: enterprise-release-ops
description: >-
  Enterprise release and operations gate for ProctiraERP PRs (tip CI honesty,
  migrations, feature flags, sandbox vs live providers, rollback, merge
  criteria). Use before merge, for CI-green claims, deploy skips, billing
  blocks, or “ready to ship” statements.
---

# Enterprise Release / Ops (Definition of Ship)

This skill is the **Definition of Ship**. A green feature branch ≠ shipped.

## When this skill applies

Trigger on: merge, ship, release, tip CI, deploy, migration, rollback, sandbox vs live, feature flag, “ready for production”, post-merge tip verification.

## Required workflow

1. Copy `docs/audits/templates/ENTERPRISE_RELEASE_OPS_CHECKLIST.md` → `docs/audits/RELEASE_<SLICE>.md` (or append to module audit).
2. Confirm tip CI **all required checks SUCCESS** on the commit being merged (not an older tip).
3. List schema/migrations and apply order; no silent Prisma-only cert paths when raw SQL is required.
4. Document external deps: IdP, Twilio/FCM/SMTP, PSP — sandbox honesty vs live secrets.
5. Confirm deploy path (or explicit “docs-only / app-only, no image deploy”).
6. After merge: verify **main tip CI** (or open follow-up if tip red).
7. Rollback note: revert commit / disable flag / reverse migration owner.

## Honesty rules

- Do not claim tip CI green from cancelled or superseded runs.
- Billing/quota failures are not “product green”.
- Skipped E2E does not equal production-ready.
- Untracked screen PNGs must not be committed unless policy allows.

## False claims — cannot be entertained

- Do **not** ship, merge-note, or scorecard-claim “Wave complete”, “N/N CLOSED”, or “production ready” without tip SHA evidence matching Done-when.
- `*_COMPLETE.md` / remediation ledgers are **not** ship proof; independent tip re-audit outranks them.
- Allowed finding dispositions only: `FULLY_CLOSED` · `PARTIAL` · `OPEN` · `REGRESSED` · `EXTERNALLY_UNVERIFIED`.
- Partial clears must list remaining residuals in the same PR/ship note.
- Pair with QA hard ban: `.cursor/skills/enterprise-module-production-ready/SKILL.md` § False claims.

## Related

- Production-ready CI pillar
- Plans under `docs/plans/`
- Evidence JSON under `docs/audits/evidence/`
