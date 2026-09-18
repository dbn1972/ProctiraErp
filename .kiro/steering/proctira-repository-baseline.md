---
inclusion: always
name: proctira-repository-baseline
description: Minimal evidence, source-of-truth, and freshness rules that apply to every ProctiraErp task.
---

# ProctiraErp repository baseline

Apply these rules to every task while keeping specialist guidance conditional.

- Treat `package.json` and the relevant workspace manifest as authoritative for package-manager versions, scripts, engines, and available checks. Do not preserve copied command lists when manifests disagree.
- Use this evidence order when sources conflict: active runtime and production configuration; executable code and migrations; behavior tests using production adapters; deployment/run evidence; status documents; names, comments, TODOs, and marketing claims.
- Inspect the active path before proposing or editing. Package, route, schema, screen, manifest, or test-file existence alone does not prove runtime use or production readiness.
- Treat dated audits and readiness documents as point-in-time evidence. Revalidate findings against the current commit and report contradictions rather than silently choosing the preferred claim.
- Do not use `node_modules`, build output, coverage, generated files, or `*.tsbuildinfo` as source authorities.
- Preserve unrelated working-tree changes. Do not reformat, revert, stage, delete, or include them in validation claims.
- Follow `task-branch-pr-workflow` for every change-producing task: isolate work on a task branch, use PR review and required checks, merge only after approval, then perform verified-safe branch/worktree cleanup.
- Report what was behaviorally verified and what remains unverified; a passing command alone is not acceptance evidence.

For substantive School/SIS work, use `school-sis-erp-context` and `enterprise-school-sis-erp`. Add the product, experience, government/interoperability, security/privacy, or reliability skill that matches the concern. The detailed architecture map is `.kiro/skills/enterprise-school-sis-erp/references/architecture.md`.
