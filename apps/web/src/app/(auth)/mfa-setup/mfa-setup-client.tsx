'use client';

import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';

import MFASetup from '@/features/auth/MFASetup';

/**
 * Map the federated screen's React Router exits onto App Router paths.
 * `<MFASetup>` still calls `navigate('/auth/mfa-verify')` and links to
 * `/auth/signin`, which this Next.js app does not serve.
 */
function realAuthExit(url: string): string | null {
  const [rawPath, query = ''] = url.split('?');
  const path = rawPath ?? '';
  const search = query ? `?${query}` : '';
  if (path === '/auth/mfa-verify' || path.startsWith('/auth/mfa-verify/')) {
    return `/mfa${search}`;
  }
  if (path === '/auth/signin' || path === '/auth/login') {
    return `/login${search}`;
  }
  return null;
}

export function MfaSetupClient(): JSX.Element {
  useEffect(() => {
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);

    function intercept(original: History['pushState']): History['pushState'] {
      return function (this: History, data, unused, url) {
        if (typeof url === 'string') {
          const next = realAuthExit(url);
          if (next) {
            window.location.assign(next);
            return;
          }
        }
        return original.call(this, data, unused, url);
      };
    }

    history.pushState = intercept(push);
    history.replaceState = intercept(replace);
    return () => {
      history.pushState = push;
      history.replaceState = replace;
    };
  }, []);

  return (
    <div
      onClickCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (!href) return;
        const next = realAuthExit(href);
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(next);
      }}
    >
      <BrowserRouter>
        <MFASetup />
      </BrowserRouter>
    </div>
  );
}
