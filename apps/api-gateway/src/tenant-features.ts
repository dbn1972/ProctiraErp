/**
 * G-810 — Per-plan feature entitlements at request time.
 */
export type FeatureMap = Record<string, boolean>;

export const PREFIX_FEATURE_MAP: Record<string, string> = {
  lms: 'lms', hostel: 'hostel', transport: 'transport', library: 'library',
  fees: 'fees', billing: 'fees', health: 'health', scholarships: 'scholarship',
  'parent-portal': 'parent', registrations: 'registration', workflows: 'workflow',
  'workflow-engine': 'workflow', communication: 'communication', notifications: 'communication',
};

const featuresByTenant = new Map<string, FeatureMap>();

function bootstrapFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env['TENANT_FEATURES'];
  if (!raw) return;
  for (const part of raw.split(',')) {
    const [tenantId, featureList] = part.split(':').map((s) => s.trim());
    if (!tenantId || !featureList) continue;
    const map: FeatureMap = {};
    for (const token of featureList.split('+')) {
      const name = token.trim();
      if (!name) continue;
      if (name.startsWith('!')) map[name.slice(1)] = false;
      else map[name] = true;
    }
    featuresByTenant.set(tenantId, map);
  }
}
bootstrapFromEnv();

export function setTenantFeaturesForTests(tenantId: string, features: FeatureMap): void {
  featuresByTenant.set(tenantId, { ...features });
}
export function clearTenantFeaturesForTests(): void {
  featuresByTenant.clear();
  bootstrapFromEnv();
}

export type FeaturesUser = {
  features?: FeatureMap | string[];
  entitlements?: string[];
  config?: { features?: { modules?: FeatureMap } };
};

function fromStringList(list: string[]): FeatureMap {
  const map: FeatureMap = {};
  for (const name of list) if (name) map[name] = true;
  return map;
}

export function resolveTenantFeatures(
  tenantId: string | undefined,
  user?: FeaturesUser | null,
): FeatureMap | null {
  if (user?.features) {
    return Array.isArray(user.features) ? fromStringList(user.features) : { ...user.features };
  }
  if (user?.entitlements?.length) return fromStringList(user.entitlements);
  if (user?.config?.features?.modules) return { ...user.config.features.modules };
  if (tenantId && featuresByTenant.has(tenantId)) return { ...featuresByTenant.get(tenantId)! };
  return null;
}

export function featureRequiredForPath(urlPath: string): string | undefined {
  const path = urlPath.split('?')[0] ?? urlPath;
  const parts = path.split('/').filter(Boolean);
  const segment = parts[0] === 'api' && parts[1] === 'v1' ? parts[2] : parts[0];
  return segment ? PREFIX_FEATURE_MAP[segment] : undefined;
}

export function missingFeatureForRequest(
  tenantId: string | undefined,
  user: FeaturesUser | null | undefined,
  urlPath: string,
): string | null {
  const required = featureRequiredForPath(urlPath);
  if (!required) return null;
  const features = resolveTenantFeatures(tenantId, user);
  if (!features) return null;
  if (features[required] === true) return null;
  return required;
}
