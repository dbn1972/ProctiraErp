# `<Sidebar>` Keyboard Contract

Validates Task 56.6 / Requirement 37 AC 6.

`apps/web/src/components/layout/sidebar.tsx` renders the desktop primary
navigation. The element is a single landmark (`<aside>` containing
`<nav aria-label="Main navigation">`) with an unordered list of `<Link>`
items.

The contract below is exercised by `sidebar.keyboard.test.tsx`.

## Skip-to-content

Every authenticated route renders a skip link as the first focusable
element in the document (see `apps/web/src/components/layout/AppShell.tsx`).
Pressing `Tab` on a fresh page focuses the skip link first; activating
it with `Enter` jumps focus past the sidebar and lands on the main
content region. The skip link is therefore the recommended escape
hatch for keyboard users who do not want to walk every navigation
link.

## Tab order inside the sidebar

The sidebar uses the **native browser tab order** — there is no roving
tab index. Each navigation link is independently focusable.

| Key | Action |
| --- | --- |
| `Tab` | Move focus to the next navigation link. After the last link, focus leaves the sidebar (typically into the page header). |
| `Shift + Tab` | Move focus to the previous navigation link. After the first link, focus leaves the sidebar. |

## Activating a link

| Key | Action |
| --- | --- |
| `Enter` | Activates the focused link and navigates. |

`Space` is intentionally **not** an activation key for anchor elements
— this matches the [HTML accessibility][html-a11y-anchor] specification.
Use `Enter`. Programmatic key handlers MUST NOT bind `Space` to
navigate, because doing so makes the sidebar inaccessible to screen
reader users who rely on document scrolling with `Space`.

## Active state

The active link carries `aria-current="page"`. Screen readers announce
this as "current page", and the `.sidebar-link-active` class provides
the visual highlight.

## Forward-looking: collapsible groups

When a future iteration adds collapsible navigation groups, the
behaviour MUST follow the [WAI-ARIA Disclosure pattern][wai-aria-disclosure]:

- The group header is a `<button>` with `aria-expanded`.
- `Enter` / `Space` toggles the disclosure.
- Children appear in the natural tab order when expanded; they are not
  focusable when collapsed.

Tests for collapsible groups will be added alongside the implementation.

## Source

- Implementation: `apps/web/src/components/layout/sidebar.tsx`
- Tests: `apps/web/src/components/layout/sidebar.keyboard.test.tsx`

[html-a11y-anchor]: https://html.spec.whatwg.org/multipage/interaction.html#the-tabindex-attribute
[wai-aria-disclosure]: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
