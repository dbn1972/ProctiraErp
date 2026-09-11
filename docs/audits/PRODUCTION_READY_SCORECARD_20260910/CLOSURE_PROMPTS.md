# Closure prompts — execute after you approve each batch

**Scorecard:** `docs/audits/PRODUCTION_READY_SCORECARD_20260910/`  
**Branch:** `cursor/w10-health-dw-ux-56c3` · tip at audit: `3c93595`  
**Rule:** One batch per agent run. Re-score affected rows after merge. Tip CI honesty required.

---

## Batch 1 — Tip CI green (S0) · do first

```text
Execute Batch 1 from docs/audits/PRODUCTION_READY_SCORECARD_20260910/CLOSURE_PROMPTS.md.

Goal: Make PR #48 tip CI green on branch cursor/w10-health-dw-ux-56c3.
Scope: PRD-001 only — no feature work.

Steps:
1. Inspect latest Integration Tests / failing jobs on tip SHA.
2. If flake (gateway fetch failed / timeouts on unrelated academics pages): retrigger once; if repeats, fix root cause (webserver stability, getInstitution failures) with minimal change.
3. Do not expand Wave 10 feature scope.
4. Commit/push only CI fixes; update scorecard 00_EXEC_SUMMARY tip CI line when green.
5. Subscribe to tip CI and report final check table.
```

---

## Batch 2 — Durability & honesty (S1 product)

```text
Execute Batch 2 from docs/audits/PRODUCTION_READY_SCORECARD_20260910/CLOSURE_PROMPTS.md.

Close gaps: PRD-004, PRD-002, PRD-003, PRD-009.

1. Health special-needs: persist via PG (mirror PHI/nurse pattern) or document explicit memory-only in mount matrix + UI honesty — prefer PG.
2. Data-warehouse / Insights: classify scaffold surfaces (banner copy + PRODUCT non-goals); no false live connector claims; field-mapping page marked demo if still demo.
3. Platform admin: honesty banners accurate; stub routes called out in IA.
4. Add Playwright smoke for /pipelines create+list (gated E2E_BACKEND_READY ok).
5. Update MODULE/PAGE score sheets for Health, DW, Admin, Pipelines.
6. Commit, push, PR update, tip CI.
```

---

## Batch 3 — Security & test depth (S2)

```text
Execute Batch 3 from docs/audits/PRODUCTION_READY_SCORECARD_20260910/CLOSURE_PROMPTS.md.

Close gaps: PRD-005, PRD-006, PRD-008.

1. Add cross-role deny tests for sensitive writes: health PHI log, fees payment post, student PII update (pattern from existing tenant isolation packs).
2. Publish a short docs/testing/E2E_GATE_MATRIX.md: which specs run ungated vs E2E_BACKEND_READY.
3. Assessment report-cards: route durability to gradebook HTML path or PG; remove silent memory loss.
4. Re-score Security/Test pillars for Health, Fees, Students, Assessments.
5. Commit, push, tip CI.
```

---

## Batch 4 — External sandboxes (needs secrets) · optional

```text
Execute Batch 4 only if staging secrets are available.

Close: G-107, G-202, G-709 (sandbox proofs).
Wire Keycloak staging login e2e, PSP sandbox receipt, one SMS/email sandbox send.
If secrets missing: refresh WAIVED rows with today’s date and owner — do not fake live.
```

---

## Batch 5 — Non-goals / epics (planning only unless funded)

```text
Do not implement unless product funds these.
Confirm waivers or open epics for: PRD-007 device-farm, PRD-010 MapLibre, PRD-011 sealed PDF, PRD-012 LTI/SCORM, G-506 statuspage.
Update GAP_REGISTER waiver board only.
```

---

## How to tell me to proceed

Reply with one of:

- `execute batch 1`
- `execute batch 2`
- `execute batch 3`
- `execute batches 1-2`

I will implement only the named batch(es), then refresh this scorecard’s scores for touched modules.
