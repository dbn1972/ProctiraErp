# `<Sheet>` Keyboard Contract

Validates Task 56.6 / Requirement 37 AC 6.

`<Sheet>` is a slide-out drawer built on `@radix-ui/react-dialog`. The
keyboard contract is identical to `<Dialog>` (modal focus trap +
`Escape` to dismiss); the only difference is the visual side from
which the panel slides in.

## Sides

`side` values are `top`, `right` (default), `bottom`, `left`. The side
affects layout only; the keyboard model is the same in every case.

## Opening

| Key               | Action                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| `Enter` / `Space` | When focus is on `<SheetTrigger>`, activates the trigger and opens the sheet. |

When the sheet opens, focus moves to the first tabbable element
inside `<SheetContent>`. The trigger is recorded as the return focus
target.

## Focus trap (while the sheet is open)

| Key           | Action                                                              |
| ------------- | ------------------------------------------------------------------- |
| `Tab`         | Cycles forward through focusable elements inside the sheet. Wraps.  |
| `Shift + Tab` | Cycles backward through focusable elements inside the sheet. Wraps. |

## Dismissal

| Key      | Action                                                         |
| -------- | -------------------------------------------------------------- |
| `Escape` | Closes the sheet. Focus returns to the trigger that opened it. |

The auto-rendered close button is also reachable via `Tab` and
activatable with `Enter` / `Space`.

## Source

- Implementation: `Sheet.tsx`
- Tests: `Sheet.keyboard.test.tsx`

[wai-aria-dialog]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
