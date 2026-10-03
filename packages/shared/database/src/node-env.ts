/**
 * PRC-L579: NODE_ENV comparison shared by the database fail-closed guards.
 *
 * `NODE_ENV=Production` or ` production ` must trip the same guards as the
 * exact string, so the value is trimmed and lowercased before comparison.
 */

import { isProductionNodeEnv as sharedIsProductionNodeEnv } from '@proctira/common/node-env';
export function isProductionNodeEnv(nodeEnv: string | undefined): boolean {
  return sharedIsProductionNodeEnv(nodeEnv);
}
