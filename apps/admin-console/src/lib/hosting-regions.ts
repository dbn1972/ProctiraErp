/**
 * Hosting regions the admin console provisions.
 * India (`ap-south-1`) is listed first to reflect the platform's default
 * data-residency region (PRC-L203); the string is validated downstream via
 * `HOSTING_REGION_VALUES`. Operators must pick one — the form does not default.
 */
export const HOSTING_REGIONS = [
  { value: 'ap-south-1', label: 'India (Mumbai)' },
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
] as const;

export const HOSTING_REGION_VALUES = HOSTING_REGIONS.map((region) => region.value) as [
  (typeof HOSTING_REGIONS)[number]['value'],
  ...(typeof HOSTING_REGIONS)[number]['value'][],
];

export type HostingRegion = (typeof HOSTING_REGIONS)[number]['value'];
