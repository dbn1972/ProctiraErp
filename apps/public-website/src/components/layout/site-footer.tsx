import Link from 'next/link';

interface FooterGroup {
  readonly title: string;
  readonly links: ReadonlyArray<{ readonly href: string; readonly label: string }>;
}

/**
 * Footer link groups. Mirrors the charter-required set so every public
 * property is reachable from any page.
 */
const FOOTER_GROUPS: ReadonlyArray<FooterGroup> = [
  {
    title: 'Product',
    links: [
      { href: '/product', label: 'Features' },
      { href: '/security', label: 'Security' },
      { href: '/status', label: 'Status' },
      { href: '/installation', label: 'Installation' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { href: '/#solutions-schools', label: 'Schools' },
      { href: '/#solutions-districts', label: 'Districts' },
      { href: '/#solutions-ministries', label: 'Ministries' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/installation', label: 'Documentation' },
      { href: '/installation#api', label: 'API Reference' },
      { href: '/installation#sdk', label: 'Plugin SDK' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/about#careers', label: 'Careers' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/cookies', label: 'Cookies' },
      { href: '/legal', label: 'Legal' },
      { href: '/compliance', label: 'Compliance' },
    ],
  },
];

/**
 * Public site footer.
 *
 * Provides discovery for every required public property (per the platform
 * charter Section 11) including legal, security, and developer resources.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="border-t border-border bg-secondary/40"
      aria-labelledby="site-footer-heading"
    >
      <h2 id="site-footer-heading" className="sr-only">
        Site footer
      </h2>
      <div className="container py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-5">
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border pt-8 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
            >
              <span className="text-sm font-bold">O</span>
            </span>
            <p className="text-sm text-muted-foreground">
              &copy; {year} ProctiraERP. All rights reserved.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/cookies" className="hover:text-foreground">
              Cookies
            </Link>
            <Link href="/status" className="hover:text-foreground">
              Status
            </Link>
            <span>
              English (US) &middot;{' '}
              <Link
                href="/contact"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                Change region
              </Link>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
