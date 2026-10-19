# Decision D6 — Delete the legacy Vite SPA

**Decided by:** owner · **Status:** ACCEPTED

## Decision

Remove the legacy, unmounted Vite single-page app entirely. The Next.js app is
the one and only web client. The legacy SPA (old `App.tsx`, route-registry,
`features/*` dead pages, `featureRegistry` runtime-import, legacy `vite.config.ts`
test block) is dead code that is not reachable from the mounted Next.js app and
cannot be verified; it only generates audit findings for code that never runs.

## Scope

- Delete the unmounted SPA source, its route registry, and the legacy
  `vite.config.ts`/SPA-only test scaffolding that exist solely to serve it.
- Do NOT remove anything the Next.js app imports. Verify reachability before
  deleting each file (a file existing is not proof it is used; a file being
  unreachable from the Next.js entrypoints is proof it is dead).
- `vitest.config.ts` and real Next.js tests stay.

## Findings this unblocks

~45 "legacy SPA / tooling removal" findings in the decision register, including
the "weak client gating / dead code" cluster (e.g. PRC-L414, L415, L078, L259,
L408, L441) and the SPA-only residual of PRC-L435 (disbursement currency).
These are closed by REMOVAL: if the code is deleted, the finding is resolved
(the vulnerable/placeholder surface no longer exists). Mark each such finding
FULLY_CLOSED with evidence = "resolved by legacy SPA removal (Decision D6), PR #".

## Guardrail

This is a deletion with a large blast radius. It must go through its own PR with
a full Next.js build + the complete web/E2E suite green, proving nothing the
live app needs was removed. Any file whose reachability is ambiguous stays until
proven dead.
