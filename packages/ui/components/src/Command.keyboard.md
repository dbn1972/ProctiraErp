# `<Command>` / Combobox Keyboard Contract

Validates Task 56.6 / Requirement 37 AC 6.

The ProctiraERP `<Command>` primitive wraps [`cmdk`][cmdk]. It is the
canonical implementation for both:

- **Command palettes**, mounted inside `<CommandDialog>`.
- **Comboboxes**, mounted inside a `<Popover>` and bound to a single
  selection (consumers compose `<CommandInput>` + `<CommandList>` with
  the popover trigger).

The contract below mirrors the [WAI-ARIA Combobox pattern][wai-aria-combobox]
and is exercised by `Command.keyboard.test.tsx`.

## Focus & opening

For a popover-mounted combobox the trigger button opens the listbox
on `Enter`, `Space`, or `ArrowDown`. Focus moves into `<CommandInput>`
when the popover opens; the listbox is `aria-activedescendant`-driven
so the input keeps DOM focus while items receive virtual focus.

For `<CommandDialog>` the dialog opens (e.g., via `Cmd+K`) and focus
moves directly to `<CommandInput>`.

## Navigation inside the listbox

| Key | Action |
| --- | --- |
| `ArrowDown` | Move active item to the next visible result. Wraps to the first item. |
| `ArrowUp` | Move active item to the previous visible result. Wraps to the last item. |
| `Home` | Move active item to the first visible result. |
| `End` | Move active item to the last visible result. |

The "active" item is reflected via `aria-selected="true"` on the
`<CommandItem>` (cmdk uses `aria-selected`, not `aria-activedescendant`).

## Type-ahead

The `<CommandInput>` is a normal text input; every printable
character types into the input and `cmdk` re-runs its fuzzy filter.
Type-ahead is therefore the same as substring filtering of the visible
items.

## Selection

| Key | Action |
| --- | --- |
| `Enter` | Selects the active `<CommandItem>` (fires the item's `onSelect`). For comboboxes, this also closes the popover. |

`Space` does **not** select — it types a literal space into the input,
because the input is the active focus host. This matches the
[WAI-ARIA Combobox][wai-aria-combobox] guidance that `Space` should
type, not select, when focus is in the input.

## Dismissal

| Key | Action |
| --- | --- |
| `Escape` | Closes the popover (combobox) or dialog (`<CommandDialog>`). Focus returns to the popover trigger or the element that opened the dialog. |

## Disabled items

Items with `data-disabled="true"` are skipped by the active-descendant
cursor and are not selectable via `Enter`.

## Source

- Implementation: `Command.tsx`
- Tests: `Command.keyboard.test.tsx`

[cmdk]: https://cmdk.paco.me/
[wai-aria-combobox]: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
