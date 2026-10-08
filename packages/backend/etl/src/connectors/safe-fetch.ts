/**
 * SSRF-safe fetch for tenant-controlled ETL connectors (PRC-C003).
 *
 * The hardened implementation now lives in @proctira/common/safe-fetch so it can be shared by
 * every tenant-controlled outbound HTTP caller (ETL connectors, developer-portal webhooks,
 * notification webhook channel). This module re-exports it to preserve existing import paths.
 */
export {
  SsrfError,
  safeFetch,
  assertPublicHttpsUrl,
  assertPublicHttpsUrlDefault,
  isDisallowedAddress,
} from '@proctira/common';
export type { SafeFetchOptions } from '@proctira/common';
