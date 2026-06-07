/**
 * Server-safe theme boot script.
 *
 * `getThemeBootScript` was originally exported from `ThemeProvider`, which is a
 * `'use client'` module — importing its runtime exports into the (server)
 * RootLayout makes them client-reference proxies, so calling it throws
 * ("... is not a function"). This module has no `'use client'` directive, so the
 * server layout can call it directly. The output is identical to the client
 * provider's version.
 */

/** Suffix shared by all per-brand theme storage keys. */
export const THEME_STORAGE_KEY_SUFFIX = '-theme';

/** Storage key consulted when no brand-scoped key is present. */
export const FALLBACK_STORAGE_KEY = `proctira${THEME_STORAGE_KEY_SUFFIX}`;

/**
 * Returns a self-invoking script (as a string) that stamps the correct
 * `data-theme` attribute and `dark`/`light` class on `<html>` before React
 * hydrates, preventing a flash of the wrong theme.
 */
export function getThemeBootScript(
  fallbackKey: string = FALLBACK_STORAGE_KEY,
): string {
  return `(function(){try{var keys=Object.keys(localStorage);var mode=null;for(var i=0;i<keys.length;i++){if(keys[i].slice(-${THEME_STORAGE_KEY_SUFFIX.length})==='${THEME_STORAGE_KEY_SUFFIX}'){var v=localStorage.getItem(keys[i]);if(v==='light'||v==='dark'||v==='system'){mode=v;break;}}}if(!mode){var fb=localStorage.getItem('${fallbackKey}');if(fb==='light'||fb==='dark'||fb==='system')mode=fb;}if(!mode)mode='system';var resolved=mode;if(mode==='system'){resolved=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var root=document.documentElement;root.dataset.theme=resolved;if(resolved==='dark'){root.classList.add('dark');root.classList.remove('light');}else{root.classList.add('light');root.classList.remove('dark');}}catch(e){document.documentElement.dataset.theme='light';}})();`;
}
