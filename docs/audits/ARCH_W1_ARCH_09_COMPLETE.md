# W1-ARCH-09 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-ARCH-09 |
| Title | Generic backend runtime images execute TypeScript source through tsx. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- Production Dockerfiles `CMD`/`ENTRYPOINT` use `node dist/…`
- Bundle scripts under `tools/scripts/bundle-backend-runtime.mjs`
- Audit: `ARCH_W1_ARCH_09_TSX.md`
- Prior merge: #233

## Honest residuals

- `tsx` may remain in the install graph for local/dev; not used as prod entry
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone.
