/// Gateway pagination ceiling.
///
/// `apps/api-gateway/src/plugins/pagination-cap.ts` registers a root-level
/// `preHandler` that validates `page`/`pageSize` on every GET — before any domain
/// handler runs — against `PAGINATION_DEFAULTS.MAX_PAGE_SIZE`. A larger value is
/// rejected with `400 VALIDATION_ERROR`, so it is not a soft limit.
///
/// Kept in sync manually: Dart cannot import the TypeScript constant. If the
/// gateway's `MAX_PAGE_SIZE` changes, this must change with it.
const int kMaxApiPageSize = 100;
