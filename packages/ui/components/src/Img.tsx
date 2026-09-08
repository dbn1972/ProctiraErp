import React from 'react';

/**
 * Props accepted by `<Img />`.
 *
 * `width` and `height` are required at the type level so consumers cannot
 * accidentally render a layout-shifting `<img>`. They accept either a
 * number (CSS pixels) or a string (e.g. `"64"`, `"4rem"`).
 *
 * Behaviour defaults (Design J — Requirement 39):
 *   - `loading` defaults to `"lazy"` so below-the-fold images do not block
 *     the main thread. Pass `priority` (or set `loading="eager"`) for
 *     hero / above-the-fold images.
 *   - `decoding` defaults to `"async"` for the same reason.
 *   - When `priority` is set, `loading` becomes `"eager"` and
 *     `fetchpriority="high"` is applied so the browser preloads it.
 */
export interface ImgProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'width' | 'height' | 'loading' | 'decoding'
> {
  /** Required: rendered width in CSS pixels (or any valid CSS length string). */
  width: number | string;
  /** Required: rendered height in CSS pixels (or any valid CSS length string). */
  height: number | string;
  /** Mark the image as above-the-fold (skips lazy-loading and hints high priority). */
  priority?: boolean;
  /** Override the default `loading="lazy"`. */
  loading?: 'lazy' | 'eager';
  /** Override the default `decoding="async"`. */
  decoding?: 'async' | 'sync' | 'auto';
  /** Set the image's resource fetch priority. */
  fetchpriority?: 'high' | 'low' | 'auto';
}

/**
 * `<Img />` is the ProctiraERP image wrapper. It enforces the platform image
 * strategy at the type level (width + height required) and applies safe
 * defaults so every non-hero image lazy-loads.
 *
 * Usage:
 * ```tsx
 * <Img src="/avatar.jpg" alt="" width={48} height={48} />          // lazy
 * <Img src="/hero.jpg"   alt="..." width={1200} height={600} priority />
 * ```
 *
 * Validates: Requirements 39.1, 39.2 — Design J.
 */
export const Img = React.forwardRef<HTMLImageElement, ImgProps>(function Img(
  { priority = false, loading, decoding, width, height, alt, fetchpriority, ...rest },
  ref,
) {
  const resolvedLoading = loading ?? (priority ? 'eager' : 'lazy');
  const resolvedDecoding = decoding ?? 'async';
  // The DOM attribute is `fetchpriority` (all lowercase). React 18
  // does not recognise the camelCase variant, so we forward the
  // attribute via spread to stay compatible with both React 18 and 19.
  const resolvedFetchPriority = fetchpriority ?? (priority ? 'high' : undefined);
  const fetchPriorityAttr = resolvedFetchPriority ? { fetchpriority: resolvedFetchPriority } : null;

  return (
    <img
      ref={ref}
      // alt="" is required for purely decorative images; surface that
      // explicitly so consumers don't trip the JSX a11y rule by omitting it.
      alt={alt ?? ''}
      width={width}
      height={height}
      loading={resolvedLoading}
      decoding={resolvedDecoding}
      {...fetchPriorityAttr}
      {...rest}
    />
  );
});
