# proctira_api_client

Hand-rolled Dart bindings for the ProctiraERP Unified Platform backend.

The eventual goal is to generate this package directly from the aggregated
OpenAPI document served by the API Gateway. Until that pipeline lands the types
here are kept in sync with the Typebox schemas under
`packages/backend/*/src/schemas.ts`. Run `bash make_clients.sh` to regenerate
them once code generation is wired up.

## Layout

- `lib/src/models/` — DTOs that mirror backend response objects. Every entity
  exposes `id` and `version` fields used by the mobile sync engine for
  optimistic concurrency control.
- `lib/src/api/` — typed wrappers around a shared `Dio` instance. Each method
  forwards an optional `ifMatch` parameter so callers can send the
  `If-Match: <version>` header on update / delete operations.
- `lib/proctira_api_client.dart` — public entry point.

## Conflict semantics

Mutating endpoints accept the entity's last known version via `If-Match`. The
backend returns `409 Conflict` when the version is stale; this is surfaced as a
`ConflictException` so the caller can reconcile.
