/**
 * Federated Feature Module Registry
 *
 * Each feature module registers itself here with metadata describing its
 * route prefix, lazy import, required permissions, and visibility scope.
 * The RootRouter consumes this registry to produce route groups dynamically.
 *
 * This gives module-federation-like decoupling — modules can be added or
 * removed without touching the root router — while keeping a single Vite
 * build for the SPA.
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
  /** Lazy import function returning the module's root component */
  lazyImport: () => Promise<{ default: React.ComponentType }>;
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
    lazyImport: () => import('./features/marketing/LandingPage'),
    requiredPermissions: [],
    scope: 'public',
    isIndex: true,
  },
  {
    id: 'about',
    label: 'About',
    icon: 'book-open',
    routePrefix: 'about',
    lazyImport: () => import('./features/marketing/AboutPage'),
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'features',
    label: 'Features',
    icon: 'megaphone',
    routePrefix: 'features',
    lazyImport: () => import('./features/marketing/FeaturesPage'),
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'pricing',
    label: 'Pricing',
    icon: 'scale',
    routePrefix: 'pricing',
    lazyImport: () => import('./features/marketing/PricingPage'),
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'contact',
    label: 'Contact',
    icon: 'megaphone',
    routePrefix: 'contact',
    lazyImport: () => import('./features/marketing/ContactPage'),
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'demo',
    label: 'Demo',
    icon: 'globe',
    routePrefix: 'demo',
    lazyImport: () => import('./features/marketing/DemoPage'),
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'privacy',
    label: 'Privacy Policy',
    icon: 'shield',
    routePrefix: 'legal/privacy',
    lazyImport: () => import('./features/legal/PrivacyPolicy'),
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'terms',
    label: 'Terms of Service',
    icon: 'scale',
    routePrefix: 'legal/terms',
    lazyImport: () => import('./features/legal/TermsOfService'),
    requiredPermissions: [],
    scope: 'public',
  },
  {
    id: 'registration',
    label: 'Registration',
    icon: 'user-plus',
    routePrefix: 'registration',
    lazyImport: () => import('./features/registration/RegistrationRouter'),
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
    lazyImport: () => import('./features/auth/SignIn'),
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'signup',
    label: 'Sign Up',
    icon: 'user-plus',
    routePrefix: 'signup',
    lazyImport: () => import('./features/auth/SignUp'),
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'forgot-password',
    label: 'Forgot Password',
    icon: 'key',
    routePrefix: 'forgot-password',
    lazyImport: () => import('./features/auth/ForgotPassword'),
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'mfa-setup',
    label: 'MFA Setup',
    icon: 'shield',
    routePrefix: 'mfa-setup',
    lazyImport: () => import('./features/auth/MFASetup'),
    requiredPermissions: [],
    scope: 'auth',
  },
  {
    id: 'mfa-verify',
    label: 'MFA Verify',
    icon: 'shield',
    routePrefix: 'mfa-verify',
    lazyImport: () => import('./features/auth/MFAVerify'),
    requiredPermissions: [],
    scope: 'auth',
  },

  // ─── APP scope (authenticated dashboard shell) ─────────────────────────
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'layout-dashboard',
    routePrefix: 'dashboard',
    lazyImport: () => import('./features/dashboards/HomeRouter'),
    requiredPermissions: [],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'institutions',
    label: 'Institutions',
    icon: 'school',
    routePrefix: 'institutions',
    lazyImport: () => import('./features/institutions/InstitutionsRouter'),
    requiredPermissions: ['institution.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'students',
    label: 'Students',
    icon: 'users',
    routePrefix: 'students',
    lazyImport: () => import('./features/students/StudentsRouter'),
    requiredPermissions: ['student.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'staff',
    label: 'Staff',
    icon: 'user-check',
    routePrefix: 'staff',
    lazyImport: () => import('./features/staff/StaffRouter'),
    requiredPermissions: ['staff.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'attendance',
    label: 'Attendance',
    icon: 'calendar-check',
    routePrefix: 'attendance',
    lazyImport: () => import('./features/attendance/AttendanceRouter'),
    requiredPermissions: ['attendance.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'assessment',
    label: 'Assessment',
    icon: 'clipboard-list',
    routePrefix: 'assessment',
    lazyImport: () => import('./features/assessment/AssessmentRouter'),
    requiredPermissions: ['assessment.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'examinations',
    label: 'Examinations',
    icon: 'graduation-cap',
    routePrefix: 'examinations',
    lazyImport: () => import('./features/examinations/ExaminationsRouter'),
    requiredPermissions: ['examination.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'scholarships',
    label: 'Scholarships',
    icon: 'graduation-cap',
    routePrefix: 'scholarships',
    lazyImport: () => import('./features/scholarships/ScholarshipsRouter'),
    requiredPermissions: ['scholarship.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'health',
    label: 'Health',
    icon: 'heart',
    routePrefix: 'health',
    lazyImport: () => import('./features/health/HealthRouter'),
    requiredPermissions: ['health.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'workflows',
    label: 'Workflows',
    icon: 'file-text',
    routePrefix: 'workflows',
    lazyImport: () => import('./features/workflows/WorkflowsRouter'),
    requiredPermissions: ['workflow.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'data-warehouse',
    label: 'Data Warehouse',
    icon: 'bar-chart-3',
    routePrefix: 'data-warehouse',
    lazyImport: () => import('./features/data-warehouse/DataWarehouseRouter'),
    requiredPermissions: ['data-warehouse.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: 'bar-chart-3',
    routePrefix: 'analytics',
    lazyImport: () => import('./features/analytics/AnalyticsDashboard'),
    requiredPermissions: ['analytics.read'],
    scope: 'app',
  },
  {
    id: 'etl',
    label: 'ETL Pipelines',
    icon: 'file-text',
    routePrefix: 'etl',
    lazyImport: () => import('./features/etl/EtlRouter'),
    requiredPermissions: ['etl.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'file-bar-chart',
    routePrefix: 'reports',
    lazyImport: () => import('./features/reports/ReportsRouter'),
    requiredPermissions: ['report.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    routePrefix: 'settings',
    lazyImport: () => import('./features/settings/SettingsRouter'),
    requiredPermissions: ['settings.read'],
    scope: 'app',
    hasSubRoutes: true,
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'help-circle',
    routePrefix: 'help',
    lazyImport: () => import('./features/help/HelpGuide'),
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
    lazyImport: () => import('./features/mobile/MobileDashboard'),
    requiredPermissions: [],
    scope: 'mobile',
    requiredFeatureFlag: 'legacy_mobile_routes',
  },
  {
    id: 'mobile-attendance',
    label: 'Attendance',
    icon: 'calendar-check',
    routePrefix: 'attendance',
    lazyImport: () => import('./features/mobile/MobileAttendance'),
    requiredPermissions: ['attendance.read'],
    scope: 'mobile',
    requiredFeatureFlag: 'legacy_mobile_routes',
  },
  {
    id: 'mobile-student-profile',
    label: 'Student Profile',
    icon: 'users',
    routePrefix: 'student-profile',
    lazyImport: () => import('./features/mobile/MobileStudentProfile'),
    requiredPermissions: ['student.read'],
    scope: 'mobile',
    requiredFeatureFlag: 'legacy_mobile_routes',
  },
];

/** Helper to filter registry by scope */
export function getModulesByScope(scope: VisibilityScope): FeatureModule[] {
  return featureRegistry.filter((m) => m.scope === scope);
}

/** Helper to find a module by ID */
export function getModuleById(id: string): FeatureModule | undefined {
  return featureRegistry.find((m) => m.id === id);
}

/** Get all unique feature IDs for chunk naming */
export function getFeatureChunkIds(): string[] {
  return featureRegistry.map((m) => m.id);
}
