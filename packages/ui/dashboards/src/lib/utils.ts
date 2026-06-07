/**
 * Tiny class-name combiner mirroring shadcn/ui's `cn` utility. We avoid
 * pulling in `clsx` + `tailwind-merge` here because the dashboard widgets
 * never need conflict resolution — they only conditionally append their
 * own classes alongside an optional `className` override.
 *
 * If a widget ever needs Tailwind class-merging semantics, swap this for
 * `cn` from `@proctira/ui-components` (currently not exported) or
 * tailwind-merge directly.
 */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(' ');
}
