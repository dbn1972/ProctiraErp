/**
 * @vitest-environment jsdom
 *
 * V15 — axe over the surfaces a user reaches when something has gone wrong.
 *
 * The existing axe coverage scans routes on their happy path: `a11y-axe.spec.ts` visits
 * pages that loaded, and `dark-mode-parity.spec.ts` scans them in both themes. Nothing
 * scanned a *failure* surface, which is the one a user meets while already confused and
 * least able to work around a broken heading order or an unlabelled control.
 *
 * It cannot be done in the E2E suite. `ListLoadFailure` renders from a server component
 * when a read is denied, so `page.route` cannot fabricate the 403 that produces it — the
 * fetch never leaves the server. So these are component scans, which is weaker than a real
 * browser (no tenant CSS, no real contrast) and is stated as such in the audit rather than
 * presented as a full accessibility pass.
 *
 * What this does catch, and what the shared panels were at risk of: a heading that skips a
 * level under the page `h1`, a live region with the wrong assertiveness for the moment it
 * fires, a control with no accessible name, and an icon carrying meaning no screen reader
 * can reach.
 */
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { ListFailureKind } from '@/lib/api/list-result';
import messages from '@/messages/en.json';

import { ListLoadFailure } from './list-load-failure';
import { RouteErrorPanel } from './route-error';

const KINDS: ListFailureKind[] = ['unauthenticated', 'denied', 'missing', 'unavailable'];

/**
 * Wrap in a landmark with an `h1`, because that is the real context.
 *
 * Scanning the panel bare would hide the violation most likely to occur: these panels render
 * under a page heading, so an `h3` where an `h2` belongs is an `heading-order` failure that
 * only appears when the `h1` is present. The panel is documented as `h2` for exactly this
 * reason, and this is what holds it to that.
 *
 * The real `en` catalogue is supplied rather than a stub, so a key that exists in the
 * component but not in `messages/en.json` shows up here as the English fallback it really
 * renders instead of passing against invented messages.
 */
function inPageContext(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <main>
        <h1>Hostel</h1>
        {node}
      </main>
    </NextIntlClientProvider>
  );
}

describe('ListLoadFailure — axe', () => {
  for (const kind of KINDS) {
    it(`has no violations for the ${kind} state`, async () => {
      const { container } = render(
        inPageContext(<ListLoadFailure kind={kind} status={403} requestId="req-a11y-1" />),
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it('has no violations with the retry control and both reference lines present', async () => {
    // The densest variant: heading, body, button, HTTP reference and request id together.
    const { container } = render(
      inPageContext(<ListLoadFailure kind="unavailable" status={503} requestId="req-a11y-2" />),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations with the sign-in link present', async () => {
    const { container } = render(
      inPageContext(<ListLoadFailure kind="unauthenticated" returnTo="/hostel" status={401} />),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('announces politely rather than interrupting', async () => {
    // Not an axe rule — a judgement axe cannot make. This panel renders during ordinary page
    // load, so an assertive region would cut across a screen-reader user mid-navigation. The
    // assertion pins the reasoning written in the component.
    const { container } = render(inPageContext(<ListLoadFailure kind="denied" />));
    const panel = container.querySelector('[data-testid="list-load-failure"]');
    expect(panel).toHaveAttribute('role', 'status');
    expect(panel).not.toHaveAttribute('aria-live', 'assertive');
  });

  it('does not rely on the icon to carry the meaning', async () => {
    // Requirement 37.7 / "no colour-or-icon-only meaning": the icon is decorative and the
    // heading carries the state, so a missing `aria-hidden` here would be a real regression.
    const { container } = render(inPageContext(<ListLoadFailure kind="missing" />));
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('RouteErrorPanel — axe', () => {
  it('has no violations', async () => {
    const { container } = render(
      inPageContext(
        <RouteErrorPanel
          error={Object.assign(new Error('boom'), { digest: 'abc123' })}
          reset={() => {}}
        />,
      ),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('interrupts, because a render failure is not a page-load state', async () => {
    // The opposite call to `ListLoadFailure`, deliberately: the content the user was reading
    // has been replaced, so an assertive announcement is correct here.
    const { container } = render(
      inPageContext(<RouteErrorPanel error={new Error('boom')} reset={() => {}} />),
    );
    const panel = container.querySelector('[data-testid="route-error-panel"]');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel).toHaveAttribute('aria-live', 'assertive');
  });

  it('keeps the retry control reachable by name', async () => {
    const { container } = render(
      inPageContext(<RouteErrorPanel error={new Error('boom')} reset={() => {}} />),
    );
    const button = container.querySelector('[data-testid="route-error-reset"]');
    expect(button?.textContent?.trim()).toBeTruthy();
  });
});
