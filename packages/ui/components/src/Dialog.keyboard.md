# `<Dialog>` Keyboard Contract

Validates Task 56.6 / Requirement 37 AC 6.

The ProctiraERP `<Dialog>` primitive wraps `@radix-ui/react-dialog`. It is
a modal dialog: focus is trapped inside the dialog while it is open and
content outside the dialog is `inert` to keyboard and assistive
technologies. The contract below mirrors the
[WAI-ARIA Modal Dialog pattern][wai-aria-dialog] and is exercised by
`Dialog.keyboard.test.tsx`.

## Opening

| Key | Action |
| --- | --- |
| `Enter` / `Space` | When focus is on `<DialogTrigger>`, activates the trigger and opens the dialog. |

When the dialog opens:

- Focus is moved to the first tabbable element inside `<DialogContent>`.
  Consumers who need a different initial focus target can attach a
  `ref` and call `.focus()` inside the `onOpenAutoFocus` handler, or
  pass the element via `autoFocus`.
- The trigger remains the **return focus target** for when the dialog
  closes.

## Focus trap (while the dialog is open)

| Key | Action |
| --- | --- |
| `Tab` | Move focus to the next focusable element inside the dialog. Wraps from the last to the first focusable element. |
| `Shift + Tab` | Move focus to the previous focusable element inside the dialog. Wraps from the first to the last focusable element. |

## Dismissal

| Key | Action |
| --- | --- |
| `Escape` | Closes the dialog. Focus returns to the element that opened it (the original trigger). |

The Radix close button (rendered automatically by `<DialogContent>`)
is also reachable via `Tab` and is activatable with `Enter` / `Space`.

## Source

- Implementation: `Dialog.tsx`
- Tests: `Dialog.keyboard.test.tsx`

[wai-aria-dialog]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
