'use client';

/**
 * Last-resort boundary, for a failure in the root layout itself.
 *
 * `error.tsx` renders inside the root layout. When the thing that threw *is* the root
 * layout — the tenant-theme fetch, the locale/messages load, the provider tree — React
 * unmounts it, and only `global-error.tsx` is left. Next replaces the whole document, so
 * this file must supply its own `<html>` and `<body>`.
 *
 * ## Why the styling is inline
 *
 * Tailwind classes and the design tokens both arrive through `globals.css`, which the root
 * layout imports. This component renders *instead of* that layout, so class names are not
 * reliable here — and a stylesheet failing to load is itself one of the ways this boundary
 * gets reached. Inline styles are the only presentation that cannot depend on the thing
 * that may have broken. They deliberately use plain hex rather than `var(--background)`
 * for the same reason.
 *
 * Copy is English and dependency-free on purpose: `next-intl` needs the message catalogue
 * the failing layout was loading, so calling it here risks throwing inside the error
 * boundary — which produces the blank page this file exists to prevent.
 *
 * `digest` is the only identifier Next gives the client for a server-side render error;
 * the matching stack is in the server log under the same value. It is shown so a user can
 * quote something, for the same reason the gateway error envelope now carries `requestId`.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          color: '#0f1729',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <main
          role="alert"
          aria-live="assertive"
          data-testid="global-error"
          style={{
            maxWidth: '32rem',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
            The application could not finish loading. Nothing you were working on has been
            submitted. Try again, and if it keeps happening, contact your administrator.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            data-testid="global-error-reset"
            style={{
              cursor: 'pointer',
              border: 0,
              borderRadius: '0.5rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              backgroundColor: '#4f46e5',
              color: '#ffffff',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p
              style={{ fontSize: '0.75rem', opacity: 0.7, margin: '1.5rem 0 0' }}
              data-testid="global-error-digest"
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
