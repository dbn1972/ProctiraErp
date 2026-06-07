/**
 * Brand icons for the supported OAuth/OIDC providers.
 * Pulled from the official brand guidelines and inlined as SVG so we don't
 * need to ship binary assets.
 */
export function OAuthIcon({ provider }: { provider: string }): JSX.Element {
  switch (provider) {
    case 'google':
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
      );
    case 'microsoft':
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11.4 24H0V12.6h11.4V24z" fill="#F1511B" />
          <path d="M24 24H12.6V12.6H24V24z" fill="#80CC28" />
          <path d="M11.4 11.4H0V0h11.4v11.4z" fill="#00ADEF" />
          <path d="M24 11.4H12.6V0H24v11.4z" fill="#FBBC09" />
        </svg>
      );
    case 'apple':
      // Apple's brand guidelines: monochrome glyph, currentColor so it
      // adapts to light/dark themes the same way `Sign in with Apple`
      // buttons do in HIG.
      return (
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 16.32c-.567 1.31-.84 1.9-1.57 3.06-1.02 1.6-2.46 3.59-4.243 3.59-1.583 0-2-.97-4.15-.97-2.155 0-2.6.97-4.18.97-1.785 0-3.144-1.84-4.165-3.43-2.853-4.46-3.16-9.69-1.394-12.49 1.252-1.99 3.226-3.16 5.083-3.16 1.89 0 3.077 1.04 4.64 1.04 1.515 0 2.435-1.04 4.62-1.04 1.65 0 3.4.9 4.65 2.46-4.087 2.24-3.42 8.07.71 9.97z" />
        </svg>
      );
    default:
      return (
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z" />
        </svg>
      );
  }
}
