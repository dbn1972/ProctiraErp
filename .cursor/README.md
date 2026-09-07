# Cursor project config — ProctiraERP

## Mandatory skills for module testing

When the user asks for full / E2E / production-ready / enterprise testing of a redesign module (Scholarships, Health, etc.), agents **must** follow:

- `.cursor/skills/enterprise-module-production-ready/SKILL.md`
- Checklist: `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`

Project hooks (`.cursor/hooks.json`) arm an enterprise-test session and follow up on `stop` until evidence exists.

## Laptop CPU (local Cursor Desktop)

Cloud Agents run in a remote VM and do **not** use your laptop CPU. If Activity Monitor / Task Manager shows `Cursor Helper (Plugin): extension-host` pegged on **civitasone-suite** / this repo, that is a **separate local Cursor window** indexing this monorepo (75 packages, 72 tsconfigs, type-aware ESLint, optional Dart).

This repo now ships:

- `.cursorignore` / `.cursorindexingignore` — keep generated trees and screenshots out of AI indexing
- `.vscode/settings.json` — file-watcher, search, TypeScript, ESLint-on-save, and Dart exclusions
- `.ignore` — ripgrep / search scans

After pulling:

1. Close extra local Cursor windows that have this repo open if you are using Cloud Agents.
2. Command Palette → **Developer: Reload Window**, then Cursor Settings → Indexing → **Resync Index**.
3. Disable unused language extensions in this workspace (Dart/Flutter if you are not editing `apps/mobile`, extra AI extensions stacked on Cursor’s built-in AI).

## What “done” means

Route smoke + green CI with skipped Playwright is **not** enterprise production-ready. Required pillars: functionality, live E2E where feasible, UX/a11y, multidevice screenshots, security/tenant/RBAC, CI gates, evidence pack.
