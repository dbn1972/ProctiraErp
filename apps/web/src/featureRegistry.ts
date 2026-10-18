/**
 * Federated Feature Module Registry
 *
 * Each feature module registers itself here with navigation metadata
 * describing its route prefix, required permissions, and visibility scope.
 *
 * This registry is a pure metadata source for the live Next.js App Router
 * surfaces (e.g. `CommandPalette.buildPaletteItems`). The legacy Vite SPA
 * and its `RootRouter`/`lazyImport` consumption were removed under Decision
 * D6 (legacy SPA removal); the registry intentionally no longer carries any
 * component import edges.
 */

/** Visibility scope determines which route group a feature belongs to */
export type VisibilityScope = 'public' | 'auth' | 'app' | 'mobile';

/** Icon keys correspond to lucide-react icon names */
export type IconKey =
  | 'layout-dashboard'
  | 'school'
  | 'users'
  | 'user-check'
  | 'calendar-check'
  | 'clipboard-list'
  | 'file-text'
  | 'graduation-cap'
  | 'bar-chart-3'
  | 'file-bar-chart'
  | 'settings'
  | 'help-circle'
  | 'log-in'
  | 'user-plus'
  | 'key'
  | 'shield'
  | 'smartphone'
  | 'globe'
  | 'megaphone'
  | 'book-open'
  | 'map-pin'
  | 'scale'
  | 'heart'
  | 'building'
  | (string & {});

/** A feature module descriptor in the federated registry */
export interface FeatureModule {
  /** Unique identifier for the feature (kebab-case) */
  id: string;
  /** Human-readable label for navigation */
  label: string;
  /** Icon key from lucide-react */
  icon: IconKey;
  /** Route prefix relative to its scope group (e.g. 'institutions' under /app) */
  routePrefix: string;
  /** Permissions required to access this feature (empty = no restriction) */
  requiredPermissions: string[];
  /** Which route group this feature belongs to */
  scope: VisibilityScope;
  /** Whether this feature uses a wildcard sub-router (path/*) */
  hasSubRoutes?: boolean;
  /** Whether this is the index route for its scope group */
  isIndex?: boolean;
  /**
   * Optional feature flag key from `useFeatureFlags()`. When set, the route
   * is only registered if the flag resolves to `true` for the current
   * tenant. Used to gate the legacy `/mobile/*` routes behind the
   * `legacy_mobile_routes` entitlement (Task 53.5 / Requirement 41.1).
   */
  requiredFeatureFlag?: string;
}

/**
 * The canonical feature module registry.
 * Order within each scope determines navigation order.
 */
export const featureRegistry: FeatureModule[] = [
  // ─── PUBLIC scope (anonymous, marketing + legal) ───────────────────────
  {
    id: 'landing',
    label: 'Home',
    icon: 'globe',
    routePrefix: '',
    requiredPermissions: [],
    scope: 'public',
    isIndex: true,
  },
  {
    id: 'about',
    label: 'About',
    icon: 'book-open',
    routePrefix: 'about',
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'features',
    label: 'Features',
    icon: 'megaphone',
    routePrefix: 'features',
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'pricing',
    label: 'Pricing',
    icon: 'scale',
    routePrefix: 'pricing',
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'contact',
    label: 'Contact',
    icon: 'megaphone',
    routePrefix: 'contact',
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'demo',
    label: 'Demo',
    icon: 'globe',
    routePrefix: 'demo',
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'privacy',
    label: 'Privacy Policy',
    icon: 'shield',
    routePrefix: 'legal/privacy',
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'terms',
    label: 'Terms of Service',
    icon: 'scale',
    routePrefix: 'legal/terms',
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'registration',
    label: 'Registration',
    icon: 'user-plus',
    routePrefix: 'registration',
    requiredPermissions: [],
    scope: 'public',
    hasSubRoutes: true,
  },

  // ─── AUTH scope (anonymous-only auth flows) ────────────────────────────
  {
    id: 'signin',
    label: 'Sign In',
    icon: 'log-in',
    routePrefix: 'signin',
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'signup',
    label: 'Sign Up',
    icon: 'user-plus',
    routePrefix: 'signup',
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'forgot-password',
    label: 'Forgot Password',
    icon: 'key',
    routePrefix: 'forgot-password',
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'mfa-setup',
    label: 'MFA Setup',
    icon: 'shield',
    routePrefix: 'mfa-setup',
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'mfa-verify',
    label: 'MFA Verify',
    icon: 'shield',
    routePrefix: 'mfa-verify',
    requiredPermissions: [],
    scope: 'auth',
  },

  // ─── APP scope (authenticated dashboard shell) ─────────────────────────
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'layout-dashboard',
    routePrefix: 'dashboard',
    requiredPermissions: [],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'institutions',
    label: 'Institutions',
    icon: 'school',
    routePrefix: 'institutions',
    requiredPermissions: ['institution.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'students',
    label: 'Students',
    icon: 'users',
    routePrefix: 'students',
    requiredPermissions: ['student.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'staff',
    label: 'Staff',
    icon: 'user-check',
    routePrefix: 'staff',
    requiredPermissions: ['staff.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'attendance',
    label: 'Attendance',
    icon: 'calendar-check',
    routePrefix: 'attendance',
    requiredPermissions: ['attendance.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'assessment',
    label: 'Assessment',
    icon: 'clipboard-list',
    routePrefix: 'assessment',
    requiredPermissions: ['assessment.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'examinations',
    label: 'Examinations',
    icon: 'graduation-cap',
    routePrefix: 'examinations',
    requiredPermissions: ['examination.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'scholarships',
    label: 'Scholarships',
    icon: 'graduation-cap',
    routePrefix: 'scholarships',
    requiredPermissions: ['scholarship.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'lms',
    label: 'Learning',
    icon: 'book-open',
    routePrefix: 'lms',
    requiredPermissions: ['lms.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'health',
    label: 'Health',
    icon: 'heart',
    routePrefix: 'health',
    requiredPermissions: ['health.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'workflows',
    label: 'Workflows',
    icon: 'file-text',
    routePrefix: 'workflows',
    requiredPermissions: ['workflow.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'data-warehouse',
    label: 'Data Warehouse',
    icon: 'bar-chart-3',
    routePrefix: 'data-warehouse',
    requiredPermissions: ['data-warehouse.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: 'bar-chart-3',
    routePrefix: 'analytics',
    requiredPermissions: ['analytics.read'],
    scope: 'app',
  },
  {
    id: 'etl',
    label: 'ETL Pipelines',
    icon: 'file-text',
    routePrefix: 'etl',
    requiredPermissions: ['etl.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'file-bar-chart',
    routePrefix: 'reports',
    requiredPermissions: ['report.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    routePrefix: 'settings',
    requiredPermissions: ['settings.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'help-circle',
    routePrefix: 'help',
    requiredPermissions: [],
    scope: 'app',
  },

  // ─── MOBILE scope (mobile-optimized views) ─────────────────────────────
  // The legacy /mobile/* routes are gated behind the `legacy_mobile_routes`
  // entitlement (defaults to off). New tenants get the responsive shell from
  // Task 53.1 by default; existing tenants can opt in to the legacy
  // experience while their bookmarks and external links migrate.
  // (Task 53.5 / Requirements 41.1, 29.5 / Design §H.)
  {
    id: 'mobile-dashboard',
    label: 'Dashboard',
    icon: 'layout-dashboard',
    routePrefix: 'dashboard',
    requiredPermissions: [],
    scope: 'mobile',
    requiredFeatureFlag: 'legacy_mobile_routes',
  },
  {
    id: 'mobile-attendance',
    label: 'Attendance',
    icon: 'calendar-check',
    routePrefix: 'attendance',
    requiredPermissions: ['attendance.read'],
    scope: 'mobile',
    requiredFeatureFlag: 'legacy_mobile_routes',
  },
  {
    id: 'mobile-student-profile',
    label: 'Student Profile',
    icon: 'users',
    routePrefix: 'student-profile',
    requiredPermissions: ['student.read'],
    scope: 'mobile',
    requiredFeatureFlag: 'legacy_mobile_routes',
  },
];

/** Helper to find a module by ID */
export function getModuleById(id: string): FeatureModule | undefined {
  return featureRegistry.find((m) => m.id === id);
}
