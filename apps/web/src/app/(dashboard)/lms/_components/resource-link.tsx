import { safeHref } from '@/lib/safe-url';

/**
 * Only http(s) URLs become links (PRC-H024 / PRC-H033); anything else — e.g. a
 * legacy `javascript:` row — renders as inert text so it can never execute.
 */
export function ResourceLink({ url }: { url: string }) {
  const href = safeHref(url);
  if (!href) {
    return (
      <>
        {' '}
        <span className="break-all text-muted-foreground" data-testid="lms-resource-unsafe-url">
          {url} (link disabled: not an http or https address)
        </span>
      </>
    );
  }
  return (
    <>
      {' '}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center break-all underline"
      >
        {url}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </>
  );
}
