/**
 * Volume 12 §3 — the test environment matrix, as data.
 *
 * `docs/multitenant/volume_12_product_quality_assurance_validation_and_release_readiness_specification.md`
 * enumerates three independent axes:
 *
 *   §3.1 seven **viewport classes**  — mobile portrait/landscape, small/large tablet,
 *                                      laptop, desktop, large desktop.
 *   §3.2 seven **device classes**    — iPhone-size, Android phone, iPad-size, large
 *                                      Android tablet, standard laptop, full desktop,
 *                                      high-resolution desktop.
 *   §3.3 four  **browser classes**   — Chrome, Edge, Safari, Firefox.
 *
 * ## Why this file exists
 *
 * `playwright.config.ts` used to carry the claim `// Desktop browsers (Volume 12 §3.3 —
 * Chrome, Edge, Safari, Firefox)` above a project list with **no Edge project at all**,
 * and cited §3.2 above three device presets that covered three of the seven classes. A
 * comment cannot be wrong loudly. Declaring the matrix as data lets
 * `55-responsive-layout.spec.ts` assert that every class the specification names resolves
 * to a project that actually selects the intended engine — so the next omission fails a
 * test instead of reading as covered.
 *
 * ## The two axes are covered by different mechanisms, deliberately
 *
 * - **§3.1 viewport classes** are swept *inside* one test run
 *   (`browser.newContext({ viewport })`). Seven Playwright projects would multiply all
 *   ~75 web specs by seven; a sweep inside a single chromium project costs one spec.
 * - **§3.2 device classes** need the preset's user agent, device-scale factor and touch
 *   flags, which only a project can set. Those projects therefore carry a `testMatch`
 *   narrowed to the responsive spec so registering them does not re-run the whole suite.
 * - **§3.3 browser classes** need real Firefox / WebKit / Edge binaries, so they stay
 *   behind `PLAYWRIGHT_ALL_BROWSERS=1` (see `DEFAULT_PROJECTS` below).
 */

import { devices, type PlaywrightTestConfig } from '@playwright/test';

type PlaywrightProject = NonNullable<PlaywrightTestConfig['projects']>[number];

/** Specs a device-class project is allowed to run. See the header note on cost. */
const DEVICE_CLASS_TEST_MATCH = /55-responsive-layout\.spec\.ts/;

// ─── §3.1 Viewport classes ───────────────────────────────────────────────────

export type ViewportClassId =
  | 'mobile-portrait'
  | 'mobile-landscape'
  | 'small-tablet'
  | 'large-tablet'
  | 'laptop'
  | 'desktop'
  | 'large-desktop';

export interface ViewportClass {
  id: ViewportClassId;
  /** The label used in Volume 12 §3.1, so a failure names the specification row. */
  label: string;
  viewport: { width: number; height: number };
  /** Chromium-only. Drives the viewport meta / mobile emulation path. */
  isMobile: boolean;
  hasTouch: boolean;
}

/**
 * Widths are chosen so each class lands in a distinct band of the product's own
 * breakpoints: `useViewport.ts` switches `AppShell` at `max-width: 767px`, and the
 * Tailwind `md`/`lg`/`xl`/`2xl` stops are 768/1024/1280/1536. Mobile portrait and
 * landscape straddle 767 on purpose — landscape at 802px is the case that silently
 * hands a phone the desktop shell.
 */
export const VIEWPORT_CLASSES: readonly ViewportClass[] = [
  {
    id: 'mobile-portrait',
    label: 'Mobile portrait',
    viewport: { width: 393, height: 727 },
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'mobile-landscape',
    label: 'Mobile landscape',
    viewport: { width: 802, height: 293 },
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'small-tablet',
    label: 'Small tablet',
    viewport: { width: 712, height: 1138 },
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'large-tablet',
    label: 'Large tablet',
    viewport: { width: 810, height: 1080 },
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'laptop',
    label: 'Laptop',
    viewport: { width: 1280, height: 720 },
    isMobile: false,
    hasTouch: false,
  },
  {
    id: 'desktop',
    label: 'Desktop',
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  },
  {
    id: 'large-desktop',
    label: 'Large desktop / widescreen',
    viewport: { width: 1920, height: 1080 },
    isMobile: false,
    hasTouch: false,
  },
] as const;

// ─── Projects ────────────────────────────────────────────────────────────────

/**
 * Projects that need no browser binary beyond Chromium, which `pnpm test:e2e` and every
 * workflow already install. Registered unconditionally.
 *
 * `chromium`, `mobile-chrome` and `tablet` keep their existing names and presets: the
 * committed screenshots under `24-visual-regression.spec.ts-snapshots/` are keyed on the
 * project name, and `visual-regression.yml` passes them as `--project=` flags.
 */
export const DEFAULT_PROJECTS: PlaywrightProject[] = [
  // §3.2 standard laptop / §3.3 Chrome.
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
  // §3.2 Android phone.
  {
    name: 'mobile-chrome',
    use: { ...devices['Pixel 5'] },
  },
  // §3.2 iPad-size tablet. Forced to Chromium so CI needs no WebKit install — the
  // preset defaults to webkit.
  {
    name: 'tablet',
    use: {
      ...devices['iPad (gen 7)'],
      defaultBrowserType: 'chromium',
      browserName: 'chromium',
    },
  },
  // §3.2 large Android tablet. Galaxy Tab S4 is a 10.5" device whose 712px logical
  // width sits *below* the iPad's 810px, which is why both are needed: the large
  // Android tablet is the case that lands on the small-tablet side of a breakpoint.
  {
    name: 'tablet-android',
    testMatch: DEVICE_CLASS_TEST_MATCH,
    use: { ...devices['Galaxy Tab S4'] },
  },
  // §3.2 full desktop.
  {
    name: 'desktop',
    testMatch: DEVICE_CLASS_TEST_MATCH,
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  },
  // §3.2 high-resolution desktop.
  {
    name: 'desktop-large',
    testMatch: DEVICE_CLASS_TEST_MATCH,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
    },
  },
];

/**
 * Projects requiring a Firefox, WebKit or Edge binary. Opt in with
 * `PLAYWRIGHT_ALL_BROWSERS=1`; `pnpm test:e2e` installs Chromium only, so registering
 * these by default would fail every spec on a missing executable.
 *
 * Edge is a real channel, not `devices['Desktop Edge']`. That preset only swaps in an
 * Edge user-agent string while still launching bundled Chromium, so it would assert
 * nothing Chrome does not already cover. `channel: 'msedge'` launches the installed
 * Edge build and needs `playwright install msedge`.
 */
export const EXTRA_BROWSER_PROJECTS: PlaywrightProject[] = [
  // §3.3 Firefox.
  {
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] },
  },
  // §3.3 Safari.
  {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
  },
  // §3.3 Edge.
  {
    name: 'edge',
    use: { ...devices['Desktop Edge'], channel: 'msedge' },
  },
  // §3.2 iPhone-size mobile (WebKit, so it belongs to the opt-in set).
  {
    name: 'mobile-safari',
    use: { ...devices['iPhone 13'] },
  },
];

export const ALL_PROJECTS: PlaywrightProject[] = [...DEFAULT_PROJECTS, ...EXTRA_BROWSER_PROJECTS];

/** Resolve the project list for the current environment. */
export function resolveProjects(allBrowsers: string | undefined): PlaywrightProject[] {
  return allBrowsers ? ALL_PROJECTS : DEFAULT_PROJECTS;
}

// ─── §3.2 Device classes ─────────────────────────────────────────────────────

export interface DeviceClass {
  id: string;
  /** The label used in Volume 12 §3.2. */
  label: string;
  /** Name of the project in {@link ALL_PROJECTS} that covers this class. */
  project: string;
}

export const DEVICE_CLASSES: readonly DeviceClass[] = [
  { id: 'iphone-size-mobile', label: 'iPhone-size mobile', project: 'mobile-safari' },
  { id: 'android-phone', label: 'Android phone', project: 'mobile-chrome' },
  { id: 'ipad-size-tablet', label: 'iPad-size tablet', project: 'tablet' },
  { id: 'large-android-tablet', label: 'Large Android tablet', project: 'tablet-android' },
  { id: 'standard-laptop', label: 'Standard laptop', project: 'chromium' },
  { id: 'full-desktop', label: 'Full desktop', project: 'desktop' },
  { id: 'high-resolution-desktop', label: 'High-resolution desktop', project: 'desktop-large' },
] as const;

// ─── §3.3 Browser classes ────────────────────────────────────────────────────

export interface BrowserClass {
  id: string;
  /** The label used in Volume 12 §3.3. */
  label: string;
  /** Name of the project in {@link ALL_PROJECTS} that covers this class. */
  project: string;
  /** Engine the project must launch. */
  browserName: 'chromium' | 'firefox' | 'webkit';
  /**
   * Required channel, when the engine alone is not the browser. Chromium launched
   * without a channel is not Edge however its user agent reads.
   */
  channel?: string;
}

export const BROWSER_CLASSES: readonly BrowserClass[] = [
  { id: 'chrome', label: 'Chrome', project: 'chromium', browserName: 'chromium' },
  { id: 'edge', label: 'Edge', project: 'edge', browserName: 'chromium', channel: 'msedge' },
  { id: 'safari', label: 'Safari', project: 'webkit', browserName: 'webkit' },
  { id: 'firefox', label: 'Firefox', project: 'firefox', browserName: 'firefox' },
] as const;

/** Look a project up by name in the full declared matrix. */
export function findProject(name: string): PlaywrightProject | undefined {
  return ALL_PROJECTS.find((project) => project.name === name);
}
