# `<Tabs>` Keyboard Contract

Validates Task 56.6 / Requirement 37 AC 6.

The ProctiraERP `<Tabs>` primitive wraps `@radix-ui/react-tabs`. The contract
below mirrors the [WAI-ARIA Tabs pattern][wai-aria-tabs] and is exercised
by `Tabs.keyboard.test.tsx`.

## Reading & writing focus

| Key                                         | Action                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Tab`                                       | Move focus into the tab list. Focus lands on the active (`data-state="active"`) trigger.                  |
| `Tab` (when focus is on the active trigger) | Move focus out of the tab list and into the active panel (or the next focusable element after the panel). |
| `Shift + Tab`                               | Reverse direction of `Tab`.                                                                               |

## Roving tab index inside the tab list

| Key          | Action                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `ArrowRight` | (Horizontal orientation) Move focus to the next tab; wraps to the first tab when on the last.     |
| `ArrowLeft`  | (Horizontal orientation) Move focus to the previous tab; wraps to the last tab when on the first. |
| `ArrowDown`  | (Vertical orientation) Move focus to the next tab; wraps.                                         |
| `ArrowUp`    | (Vertical orientation) Move focus to the previous tab; wraps.                                     |
| `Home`       | Move focus to the first tab.                                                                      |
| `End`        | Move focus to the last tab.                                                                       |

## Activation

Radix Tabs default to **automatic activation** (`activationMode="automatic"`):
the focused tab is activated immediately. When the consumer opts into
`activationMode="manual"` (e.g., expensive panels):

| Key     | Action                     |
| ------- | -------------------------- |
| `Enter` | Activates the focused tab. |
| `Space` | Activates the focused tab. |

## RTL handling

Radix Tabs reads the document direction (`dir="rtl"`) and swaps
`ArrowLeft`/`ArrowRight` so that "next" always means _visually next_ in
the user's reading order. No additional handling is required by
consumers.

## Disabled triggers

Triggers with `disabled` are skipped by the roving focus and are not
activatable via `Enter` / `Space`.

## Source

- Implementation: `Tabs.tsx`
- Tests: `Tabs.keyboard.test.tsx`

[wai-aria-tabs]: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
