import {
  MarketingDocumentTitle,
} from '@/features/marketing/sections/MarketingStaticChrome';

const COOKIES = [
  {
    name: 'proctira_session',
    purpose:
      'Keeps you signed in and protects forms against cross-site request forgery',
    duration: 'Session',
    type: 'Essential',
  },
  {
    name: 'proctira_locale',
    purpose: 'Remembers your language and region preference',
    duration: '12 months',
    type: 'Essential',
  },
  {
    name: 'proctira_consent',
    purpose: 'Stores the cookie choices you make in the preference panel',
    duration: '6 months',
    type: 'Essential',
  },
  {
    name: 'pa_id',
    purpose:
      'Self-hosted, privacy-preserving analytics — counts visits without cross-site tracking',
    duration: '13 months',
    type: 'Analytics',
  },
  {
    name: 'pa_campaign',
    purpose:
      'Attributes visits from outreach campaigns to measure what is useful',
    duration: '30 days',
    type: 'Marketing',
  },
] as const;

/**
 * Cookie Policy — App Router page sourced from redesign/website/cookies.html.
 * Path matches marketing footer `Privacy → cookies` (`/legal/cookies`).
 */
export default function CookiePolicyPage() {
  return (
    <>
      <MarketingDocumentTitle pageTitle="Cookie Policy" />
      <main
        data-testid="legal-cookies-page"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16 lg:px-8 lg:py-20"
      >
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Legal · Cookies
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            Cookie Policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated March 2, 2026 · Applies to the ProctiraERP marketing
            site and its subdomains
          </p>
        </header>

        <p className="text-base leading-relaxed text-foreground">
          This Cookie Policy explains how the ProctiraERP public website and
          services use cookies and similar technologies. We use a deliberately
          small set — no third-party advertising trackers.
        </p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">
            What are cookies?
          </h2>
          <p className="text-base leading-relaxed text-foreground">
            Cookies are small text files a website stores on your device. They
            let the site remember your actions and preferences over time so you
            do not have to repeat them on every visit — for example, keeping you
            signed in or remembering your language.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">
            Cookies we use
          </h2>
          <p className="text-base leading-relaxed text-foreground">
            Every cookie set by this website is listed below, with its purpose,
            lifetime, and category:
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-[hsl(var(--secondary))] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Purpose</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {COOKIES.map((cookie) => (
                  <tr key={cookie.name}>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {cookie.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cookie.purpose}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cookie.duration}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cookie.type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">
            Manage preferences
          </h2>
          <p className="text-base leading-relaxed text-foreground">
            Essential cookies cannot be switched off because they are required
            for sign-in, security, and remembering your language. Analytics and
            marketing cookies can be declined; when your browser sends a Do Not
            Track or Global Privacy Control signal, analytics and marketing
            cookies are disabled automatically.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">
            Changes &amp; contact
          </h2>
          <p className="text-base leading-relaxed text-foreground">
            If we add or change a cookie, we will update this page before the
            change takes effect. Questions about cookies or this policy? Contact{' '}
            <a
              className="font-medium underline-offset-4 hover:underline"
              href="mailto:privacy@proctira.org"
            >
              privacy@proctira.org
            </a>
            .
          </p>
        </section>
      </main>
    </>
  );
}
