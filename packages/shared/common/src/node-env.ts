/**
 * PRC-L579 — one shared NODE_ENV interpretation for fail-closed guards.
 *
 * Guards across services historically compared `NODE_ENV === 'production'`
 * exactly, so `Production`, ` production ` or `PROD` silently relaxed them.
 * Every guard should use one of these helpers instead.
 *
 * - {@link isProductionNodeEnv}: true for production spellings (trimmed,
 *   case-insensitive `production` / `prod`). Use where a guard historically
 *   meant "running in production".
 * - {@link isProductionLike}: closed by default — true unless NODE_ENV is
 *   exactly `development` or `test` after normalisation. Unset, empty,
 *   `staging` and unknown values count as production-like. Use for secrets and
 *   other guards that must never relax on a misconfigured environment.
 */

/** NODE_ENV values that may relax production-like guards. */
const NON_PRODUCTION_NODE_ENVS: ReadonlySet<string> = new Set(['development', 'test']);

/** Spellings treated as production by {@link isProductionNodeEnv}. */
const PRODUCTION_NODE_ENVS: ReadonlySet<string> = new Set(['production', 'prod']);

/** Trim + lowercase a NODE_ENV value (`undefined` becomes ''). */
export function normalizeNodeEnv(nodeEnv: string | undefined | null): string {
  return (nodeEnv ?? '').trim().toLowerCase();
}

/** True for `production` / `prod` in any case or surrounding whitespace. */
export function isProductionNodeEnv(nodeEnv: string | undefined | null): boolean {
  return PRODUCTION_NODE_ENVS.has(normalizeNodeEnv(nodeEnv));
}

/**
 * True unless NODE_ENV is `development` or `test` (normalised). Unset, empty,
 * `staging` or any unknown value is production-like so guards fail closed.
 */
export function isProductionLike(nodeEnv: string | undefined | null): boolean {
  return !NON_PRODUCTION_NODE_ENVS.has(normalizeNodeEnv(nodeEnv));
}

/** APP_ENV / DEPLOY_ENV stage names that always mean a deployed environment. */
const DEPLOYED_STAGES: ReadonlySet<string> = new Set(['staging', 'production', 'prod']);

/**
 * PRC-L566 — one predicate for "this process runs in a deployed environment"
 * (staging or production), used by every production boot guard.
 *
 * True when {@link isProductionLike} holds for `nodeEnv` (so unset, empty,
 * `staging` and unknown NODE_ENV values fail closed) or when APP_ENV /
 * DEPLOY_ENV names a deployed stage (so `NODE_ENV=development` with
 * `APP_ENV=staging` is still deployed). Only `development` / `test` without a
 * deployed stage relax the guards.
 */
export function isDeployedEnvironment(
  nodeEnv: string | undefined | null,
  env: Readonly<Record<string, string | undefined>> = {},
): boolean {
  if (isProductionLike(nodeEnv)) return true;
  const stage = normalizeNodeEnv(env['APP_ENV'] ?? env['DEPLOY_ENV']);
  return DEPLOYED_STAGES.has(stage);
}
