export type MarketplacePlugin = {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly category: 'attendance' | 'reporting' | 'identity' | 'communications';
  readonly status: 'listed' | 'beta' | 'review';
  readonly summary: string;
};

/** Static catalog fixture — not a live marketplace API. */
export const MARKETPLACE_CATALOG: readonly MarketplacePlugin[] = [
  {
    id: 'attendance-sms-bridge',
    name: 'Attendance SMS Bridge',
    vendor: 'Northwind Education Labs',
    category: 'attendance',
    status: 'listed',
    summary: 'Push daily absence digests to parent SMS gateways.',
  },
  {
    id: 'board-kpi-pack',
    name: 'Board KPI Pack',
    vendor: 'District Analytics Co-op',
    category: 'reporting',
    status: 'beta',
    summary: 'Board-level enrollment and completion widgets for district dashboards.',
  },
  {
    id: 'oidc-school-sso',
    name: 'School OIDC Connector',
    vendor: 'Identity Bridge Ltd',
    category: 'identity',
    status: 'listed',
    summary: 'Map school IdP groups onto platform staff roles.',
  },
  {
    id: 'parent-digest-mailer',
    name: 'Parent Digest Mailer',
    vendor: 'Comms Studio',
    category: 'communications',
    status: 'review',
    summary: 'Weekly parent email digests with attendance and fee summaries.',
  },
] as const;
