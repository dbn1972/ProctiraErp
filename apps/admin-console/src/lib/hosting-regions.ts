/**
 * Hosting regions the admin console already provisions.
 * Values match tenant fixtures and the tenant schema examples
 * (`us-east-1`, `us-west-2`, `eu-west-1`). Operators must pick one —
 * the form does not default to a region.
 */
export const HOSTING_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
] as const;

export const HOSTING_REGION_VALUES = HOSTING_REGIONS.map((region) => region.value) as [
  (typeof HOSTING_REGIONS)[number]['value'],
  ...(typeof HOSTING_REGIONS)[number]['value'][],
];

export type HostingRegion = (typeof HOSTING_REGIONS)[number]['value'];
