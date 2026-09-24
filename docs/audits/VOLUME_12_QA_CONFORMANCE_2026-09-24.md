# Volume 12 conformance — product QA, validation and release readiness

**Specification:** `docs/multitenant/volume_12_product_quality_assurance_validation_and_release_readiness_specification.md` (v1.0, 25 April 2026)
**Graded against:** `main` = `a2d77494`
**Date (UTC):** 2026-09-24
**Method:** workflow and config source read, then executed. Every claim below that says
"measured" was produced by running something on this tip; claims that say "read" were not.

---

## Summary

Volume 12's weakest area is not missing tests. It is **tests that exist and do not run**,
and **gates that run against the wrong artefact**. Three of the four findings below are of
that shape, and none would show up in a file census.

| ID    | Finding                                                                          | Disposition    |
| ----- | -------------------------------------------------------------------------------- | -------------- |
| V12-1 | §3/§5/§10 coverage declared but never executed; §3.3 claimed a browser it lacked | `FULLY_CLOSED` |
| V12-2 | `setTheme()` was a no-op — every `[dark]` scan measured the light theme          | `FULLY_CLOSED` |
| V12-3 | `check:contrast` grades a stylesheet `apps/web` does not render                  | `OPEN`         |
| V12-4 | §13 exit criteria: 4 of 11 have no enforcing mechanism                           | `PARTIAL`      |

---

## V12-1 — the matrix was a comment, not a configuration

`FULLY_CLOSED` by this branch.

`apps/web/playwright.config.ts` carried, verbatim:

```
// Desktop browsers (Volume 12 §3.3 — Chrome, Edge, Safari, Firefox)
```

above a project list containing `chromium`, `firefox`, `webkit`, `mobile-chrome`,
`mobile-safari`, `tablet`. Measured before the change, `playwright test --list` with
`PLAYWRIGHT_ALL_BROWSERS=1` returned exactly those six. **No Edge project existed** — and
`grep -rn 'msedge\|Desktop Edge'` across `apps`, `packages`, `tools`, `.github` returned
nothing. §3.2 was cited the same way above three device presets covering three of its seven
classes. §3.1's seven viewport classes resolved to three widths: 1280×720, 810×1080 and
393×727.

§5 was worse. It names seven responsive failure classes and §13 makes responsive smoke a
release exit criterion. Three files in `apps/web/e2e` touch a viewport at all
(`24-visual-regression` pins 1280×720 for screenshot stability, `a11y-axe` runs one scan at
390×844, `touch-target-minimum` checks hit boxes at 390×844) and **none asserts that a
layout survives a width change**. Nothing between 390px and 1280px had ever been rendered
by a test.

§10's theme half had an asset. `apps/web/e2e/dark-mode-parity.spec.ts` enumerates ~125
authenticated routes × 2 themes. It was referenced by **no workflow**:

```
$ grep -rn "dark-mode-parity" .github/ tools/
(no matches)
```

It is absent from `e2e-backend-ready.yml`'s `PR_SPECS` and `NIGHTLY_SPECS`, and the only
other path that reaches it — `ci.yml`'s turbo `test:e2e` step — does not set
`E2E_BACKEND_READY`, so the dashboard block self-skipped. The ~250 route/theme scans had
never executed.

### What closed it

- `apps/web/e2e/qa-matrix.ts` — the matrix as data. Seven §3.1 viewport classes, seven
  §3.2 device classes, four §3.3 browser classes, each naming the project that covers it.
  Adds `edge` on `channel: 'msedge'`; the `Desktop Edge` preset alone swaps the user agent
  and still launches bundled Chromium, so a project using it would test Chrome twice.
- `apps/web/e2e/55-responsive-layout.spec.ts` — sweeps all seven viewport classes inside
  one project and asserts §5's failure classes. Also asserts each matrix class resolves to
  a project launching the engine it claims, so the next omission fails a test.
- Execution: both specs in `PR_SPECS` and `NIGHTLY_SPECS`; nightly and dispatch set
  `E2E_THEME_MATRIX=1` for the authenticated matrix; `visual-regression.yml` gains a weekly
  device-class step for the three new projects.

**Measured:** 35/35 tests pass across six projects; six consecutive `CI=1 --retries=0` runs
against a production build. `actionlint` clean on both changed workflows.

**Two design notes worth a reviewer's attention, because both were arrived at by being
wrong first.**

1. The sweep runs inside one test rather than as seven projects. Seven projects would
   multiply all ~75 specs in the directory by seven. The three new device-class projects
   carry a `testMatch` narrowed to one spec for the same reason — verified: the visual
   spec still lists exactly 9 tests, so no screenshot baselines are disturbed.
2. Containment is measured against the **configured device width**, not
   `window.innerWidth`. A negative control found this: injecting a 3000px block into a
   393px mobile context made `window.innerWidth` report **1572** under Chromium's
   shrink-to-fit, so `scrollWidth <= innerWidth` would pass for any overflow the layout
   viewport absorbed. The expansion is now its own assertion.

### Still not covered

- **Authenticated and table-heavy surfaces.** The sweep's route list is four
  backend-free pages, which is what makes it a per-PR gate. Data tables are the surfaces
  most likely to overflow, and §5's "table content unusable" is therefore unverified.
- **Firefox, WebKit and Edge never execute.** They are registered but need
  `PLAYWRIGHT_ALL_BROWSERS=1` plus their binaries, and no workflow sets it. §3.3 is
  _declared and self-checked_, not run. Turning it on is a CI-cost decision.
- **Tenant theme variation (§3.4)** has no automation.
- **High contrast (§3.4, §10)** has no implementation to test — `ThemeMode` is
  `light | dark | system`. Not a gap in testing; a gap in the product.
- **§4's device-behaviour checklist** (drawer fit, table degradation, keyboard on
  desktop) remains manual.

---

## V12-2 — the dark-mode scans were measuring the light theme

`FULLY_CLOSED` by this branch. This is the finding with the most consequence, because five
always-on tests were green on it.

`setTheme()` wrote `data-theme` and the `.dark` class onto `<html>` directly, with the
comment "mirroring what the ThemeProvider does". `ThemeProvider` then undid it: its mount
effect resolves `system` mode from `prefers-color-scheme` — which Playwright reports as
`light` by default — and calls `applyResolvedTheme('light')`.

Measured on `/login`, using the spec's own ordering:

```
setTheme(page, 'dark')  ->  dataset.theme read back immediately : light
                        ->  dataset.theme 3s later              : light
                        ->  body background                     : rgb(248, 250, 252)
```

So every checkpoint labelled `[dark]` scanned the light theme.

`setTheme` now drives `emulateMedia({ colorScheme })` — the input the provider actually
subscribes to — and **asserts the switch landed** before scanning, which converts a silent
no-op into a named timeout. A separate always-on block asserts first-paint resolution from
a context-level OS preference, covering the inline boot script that `emulateMedia` after
load does not exercise.

### The product defect this had been hiding

Three literals — `bg-slate-50` in `(auth)/layout.tsx` and `bg-white` in
`(auth)/_components/auth-shell.tsx` and `(auth)/login/page.tsx` — pinned the surface light
while the foreground was already tokenised. With real dark mode rendering, axe measured
settled `#e7ebf4` on `#ffffff` at **1.19:1** and `#9ca9c4` at 2.36:1, against a 4.5:1 floor.

Attribution arm: reverting the three literals fails **all five** anonymous auth routes'
dark scan; restoring them passes all five. They are now `bg-background`, which resolves to
white in light mode — so the committed visual baselines are unchanged, confirmed by running
`24-visual-regression` across all three baseline projects (9/9 pass).

### A claim from this audit's own first revision, retracted

An earlier revision reported dark `--primary` / `--primary-foreground` as a 3.34:1 WCAG AA
failure and marked `/login` and `/mfa` `test.fail()` on that basis. **That was wrong.**

`globals.css` puts 150ms `transition-colors` on themed surfaces. Sampling the same node
after a theme switch:

```
t+0ms    #ffffff on #5048e5   (still light)
t+50ms   #5c5b72 on #7278f2   (1.78:1 — neither theme)
t+150ms  #141334 on #828df8   (6.15:1 — settled dark, passes AA)
```

`document.getAnimations().length` drained 22 → 0 across that window. Every ratio in the
1.3–3.4 range this spec reported while being wired up was an interpolated sample. The
settled pair is 6.15:1 and there is no defect. The scans now freeze transitions before
measuring, the same reason `toHaveScreenshot` takes `animations: 'disabled'`, and the
exemption list is gone.

**Lesson, recorded deliberately:** the first three "violations" found by newly arming a
visual gate were all artefacts of the gate's own sampling, and the fourth was real. Two
runs of the same spec disagreeing on the _colour_ of a node — not just the verdict — was
the signal that the measurement, not the product, was the variable. Checking
`getAnimations()` before filing anything would have caught it.

---

## V12-3 — the contrast gate grades a stylesheet the app does not render

`OPEN`. Found here, not fixed here: the remedy is a design-system decision.

`ci.yml:210` runs `pnpm run check:contrast` on every lint, and it passes. It reads
`packages/ui/styles/theme.css` (`check-contrast.mjs:75`, the only default and no workflow
overrides `--theme`).

`apps/web/src/app/layout.tsx:53` imports `@/styles/globals.css`. That file declares its own
`--primary` family, in Tailwind's space-separated component form:

|                             | `packages/ui/styles/theme.css` (graded) | `apps/web/src/styles/globals.css` (rendered) |
| --------------------------- | --------------------------------------- | -------------------------------------------- |
| dark `--primary`            | `hsl(222, 47%, 52%)`                    | `234 89% 74%`                                |
| dark `--primary-foreground` | `hsl(0, 0%, 100%)`                      | `242 47% 14%`                                |
| computed ratio              | 4.93:1 (baselined)                      | 6.15:1                                       |

The two disagree on both tokens. `grep -rn globals.css tools/scripts/` returns nothing —
the gate has never read the file that governs `apps/web`'s rendered colour.

The rendered values happen to be _better_ than the graded ones for this pair, so nothing is
currently broken by it. That is luck, not a control: the gate cannot fail on a regression in
the stylesheet the product actually uses, and its ten baselined waivers describe tokens that
may not be the ones on screen.

**Needs a ruling before work starts:** is `packages/ui/styles/theme.css` authoritative with
`globals.css` reduced to consuming it, or is `globals.css` authoritative and the gate
re-pointed? The second is a smaller change but recomputes all ten baseline entries. Either
way this is design-system ownership, not a test fix, which is why this branch reports it
rather than changing tokens.

---

## V12-4 — §13 exit criteria

`PARTIAL`. Read from workflow source; not executed.

| §13 criterion                        | Mechanism                                                                          | Verdict          |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ---------------- |
| Critical journeys pass               | `e2e-backend-ready.yml`, hard PR gate, 35-spec set, `E2E_REQUIRE_LIVE=1`           | met              |
| Zero module blocking defects         | `unit-test` + `integration-test` + pg/live execution gates                         | met              |
| Schema migrations validated          | 6 always-on data gates + live catalog proofs                                       | met, strongest   |
| Responsive smoke                     | **was** `visual-regression.yml` only, path-filtered to `(auth)/**` + weekly cron   | met by this PR   |
| Mobile/tablet/desktop baseline       | 3 screens × 3 projects; now + device-class projects weekly                         | partial          |
| Theme regressions reviewed           | static token gate per PR; rendered scans **were never executed**                   | met by this PR   |
| Zero accessibility blockers          | `lint:a11y`, Lighthouse a11y ≥0.95 (frontend-filtered), axe specs in the PR gate   | partial          |
| Zero security-sensitive regressions  | `security-scans`, `tenant-isolation`, `runtime-role-gate`, all always-on           | met              |
| **Zero API contract regressions**    | none — see below                                                                   | **not enforced** |
| **Zero install/upgrade regressions** | `install-wizard` smokes only when that app changes; no upgrade path test           | **not enforced** |
| **Documentation/evidence attached**  | no pull-request template exists; `check:dod:evidence` validates two JSON artefacts | **not enforced** |

Two structural notes, both read rather than run:

**No OpenAPI document is committed.** `git ls-files | grep -Ei 'openapi|swagger'` is empty.
The spec exists only at runtime via `@fastify/swagger` (`apps/api-gateway/src/app.ts:333`),
and the only assertions are two smoke tests that `/docs/json` returns 200 with the right
title. Adding, removing or changing a route's schema cannot fail any check, so §7.2's
request/response conformance and backward compatibility have no gate. Searches for `pact`,
`oasdiff`, `openapi-diff`, `dredd` and `schemathesis` return nothing.

**Release and deploy gate only on CI's overall conclusion for the SHA.** Skipped jobs do
not make that conclusion non-success, so `ci.yml`'s path-filter skip windows propagate to
release. `e2e-backend-ready.yml`, `visual-regression.yml` and `mobile-flutter.yml` are not
referenced by either `ci-gate`, so their conclusions do not gate a release — including, note,
the journey gate that §13's first criterion depends on.

Also worth recording because it bears on "zero blocking defects": `ci.yml`'s `dod-checks`
job runs `check:dod`, not `check:dod:strict`, and fails only on error debt _new_ relative to
`tools/dod-checks/reports/baseline.json` (64 baselined errors). Pre-existing errors pass and
warnings never fail. No workflow invokes the `check:dod:strict` script that exists in
`package.json`.

---

## §9 — module-by-module quality model

`PARTIAL`. §9 requires a dedicated quality checklist per module.
`docs/audits/templates/` held 11 templates and `docs/audits/modules/` 5 filled evaluations,
but no template carried a **browser** or **theme** column, so §3.3 and §3.4 had nowhere to
be recorded — `ENTERPRISE_UX_DESIGN_REVIEW.md`'s inventory table has Desktop/Tablet/Mobile
and stops there.

`docs/audits/templates/VOLUME_12_MODULE_QA_CHECKLIST.md` adds the Appendix A fields, the
Appendix B matrix with browser and theme columns, and — deliberately — a note under the
matrix stating which axes have automation behind them, so a filled row cites a spec or a
workflow rather than a tick. Filling it per module is not done and is not claimed.

---

## What this audit did not examine

- `apps/mobile` (Flutter). `ci.yml:mobile-flutter` runs `analyze` + `test` only; no
  `integration_test` device run, no a11y or device-matrix equivalent.
- The five secondary Next apps. They are outside the `frontend` path filter, so
  `lighthouse` and `bundle-budget` do not arm for them, and `apps/admin-console` has no axe
  dependency and no a11y spec at all.
- §11 performance and reliability beyond the existing Lighthouse and bundle gates.
- §6 schema and data validation. The always-on data gates are the strongest area in the
  repository and were read, not re-run, apart from the DoD baseline comparison.
- Whether `CI Aggregate (Required)` is actually enforced by branch protection. It is the
  designed single required check; `CHARTER_GAP_TASKS.md` T7 records that `main` has no
  branch protection, which if still true means none of the above is enforced at merge.
  Not verified here — it needs repository settings access.
