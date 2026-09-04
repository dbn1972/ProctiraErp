# Cursor hooks — ProctiraERP

## Policy (least tokens)
- **No sessionStart / sessionEnd context dumps** — those burn tokens every turn.
- Prefer **alwaysApply rules** (short) + **on-demand skills** over hooks that inject files.
- Use git hooks / CI for mechanical checks, not LLM prompts.

## Recommended (host-side, not agent-injected)
- Pre-commit / CI: schema-boundary vitest for touched domains.
- Do not auto-attach large `schema.prisma` or full redesign HTML into the prompt.

## If adding Cursor hooks later
Only attach when the user explicitly asks, and only a **path list**, never file bodies.
