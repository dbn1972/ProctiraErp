# `<DataGrid>` Keyboard Contract

Validates Task 56.6 / Requirement 37 AC 6.

The ProctiraERP `<DataGrid>` (`packages/ui/data-grid/src/DataGrid.tsx`)
renders a sortable, filterable, paginated table on top of TanStack
Table. The current implementation does **not** install a roving
tab-index across data cells — each interactive control inside the
grid is independently focusable in the native document order. This
matches the [WAI-ARIA Data Grid pattern §1.2][wai-aria-grid] guidance
that grids whose data cells contain only static text **or** at most
one focusable widget per cell may rely on the standard tab sequence.

The contract below is exercised by `DataGrid.keyboard.test.tsx`.

## Tab order

| Step | Element                                        | Notes                                                                                                                  |
| ---- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | Filter inputs (when `enableFiltering` is true) | One `<input>` per filterable column.                                                                                   |
| 2    | Export button (when `enableExport` is true)    | Single button.                                                                                                         |
| 3    | Sortable column headers                        | One `<button>` per sortable column. Non-sortable headers are skipped.                                                  |
| 4    | Per-row interactive cells                      | Each focusable widget that consumers render inside `cell()` (e.g., row-action buttons). Rows are walked top-to-bottom. |
| 5    | Pagination controls                            | First, Previous, Next, Last buttons.                                                                                   |
| 6    | Page-size `<select>`                           | Single combobox.                                                                                                       |

`Shift + Tab` walks the same sequence in reverse.

## Sorting

| Key     | Action                                                                                |
| ------- | ------------------------------------------------------------------------------------- |
| `Enter` | Toggles the sort on the focused column header (none → ascending → descending → none). |
| `Space` | Same as `Enter` — `<button>` semantics.                                               |

The header carries `aria-sort` (`none` / `ascending` / `descending`)
so screen readers announce the new state.

## Pagination

| Key               | Action                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `Enter` / `Space` | Activates the focused pagination button.                                                              |
| `Tab`             | Moves through the four buttons in order: first, previous, next, last, then into the page-size select. |

The pagination region exposes `aria-live="polite"` on its info
caption so screen readers announce "Page 2 of 10" automatically when
the page changes.

## Page-size combobox

The page-size control is a native `<select>` and uses the browser's
native combobox keyboard model:

- `ArrowDown` / `ArrowUp` change the value.
- `Home` / `End` jump to the first / last option.
- Letter keys do type-ahead.
- The `change` handler updates `pagination.pageSize` immediately.

## Forward-looking: full grid keyboard navigation

A future iteration may upgrade `<DataGrid>` to the full
[WAI-ARIA Data Grid][wai-aria-grid] pattern with arrow-key cell
navigation (`ArrowUp`/`Down`/`Left`/`Right`, `PageUp`/`PageDown`,
`Ctrl+Home`/`Ctrl+End`). When that lands, the `role="grid"` attribute
will replace the current implicit `role="table"`, a roving tabindex
will be installed across cells, and the contract will be updated
here. **Tests for grid-mode arrow navigation are pending
implementation.**

## Source

- Implementation: `packages/ui/data-grid/src/DataGrid.tsx`
- Tests: `packages/ui/data-grid/src/DataGrid.keyboard.test.tsx`

[wai-aria-grid]: https://www.w3.org/WAI/ARIA/apg/patterns/grid/
