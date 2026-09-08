# @proctira/ui — Frontend Component Library

This directory holds the ProctiraERP Unified Platform's reusable UI packages.
Every package is a workspace member with the name pattern
`@proctira/ui-<package-name>` and is also reachable through the path alias
`@proctira/ui/<package-name>` (configured in `tsconfig.base.json` and
mirrored by each consumer's `tsconfig.json`).

| Package             | Purpose                                                                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `area-picker`       | Hierarchical administrative-area picker.                                                                                                                                                                                                                                                                              |
| `bulk-import`       | Multi-step Excel/CSV import wizard.                                                                                                                                                                                                                                                                                   |
| `components`        | **Canonical shadcn/ui primitives** (Button, Card, Input, Dialog, Sheet, Combobox shells, etc.) plus ProctiraERP-specific wrappers (`Img`, `FormField`). The single source of truth consumed across every app via `@proctira/ui/components`. See [shadcn primitives](#shadcn-primitives--proctiraui-components) below. |
| `data-grid`         | Server-driven data grid with virtual scrolling.                                                                                                                                                                                                                                                                       |
| `file-upload`       | Resumable, chunked file uploader.                                                                                                                                                                                                                                                                                     |
| `form-builder`      | Schema-driven form renderer.                                                                                                                                                                                                                                                                                          |
| `language-switcher` | Locale/RTL switcher.                                                                                                                                                                                                                                                                                                  |
| `motion-gate`       | Reduced-motion preference provider.                                                                                                                                                                                                                                                                                   |
| `notification-bell` | Real-time notification bell + dropdown.                                                                                                                                                                                                                                                                               |

## shadcn Primitives — `@proctira/ui/components`

Task 60.1 relocated every shadcn/ui primitive that previously lived under
`apps/web/src/components/ui/` into `packages/ui/components/`. Every app
now imports its primitives from a single workspace package:

```tsx
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@proctira/ui/components';
```

### Migrated primitives

The package ships the canonical shadcn/ui set adapted for the apps/web
Tailwind v3 build. Every primitive uses HSL CSS variables
(`hsl(var(--…))`) so it respects the ProctiraERP theme tokens defined in
`apps/web/src/styles/globals.css`.

- **Form controls**: `Button`, `Input`, `Textarea`, `Label`, `Checkbox`,
  `RadioGroup`, `Switch`, `Select` (full family), `FormField` (lightweight
  label/control/error wrapper) and the `react-hook-form` integration
  (`Form`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`,
  `FormMessage`, `useFormField`).
- **Layout & surfaces**: `Card` (+ Header/Title/Description/Content/Footer),
  `Separator`, `ScrollArea`, `Skeleton`.
- **Overlay & disclosure**: `Dialog`, `Sheet` (with `side` variants),
  `DropdownMenu`, `Popover`, `Tooltip`.
- **Display**: `Alert`, `Badge`, `Avatar`, `Accordion`, `Tabs`, `Table`
  (full family).
- **Command / Combobox**: `Command`, `CommandDialog`, `CommandInput`,
  `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`,
  `CommandShortcut`, `CommandSeparator` — pair with `Popover` for a
  Combobox or with `Dialog` for a command palette.
- **Toast**: `Toaster` (Sonner). Mount once at the application root.
- **ProctiraERP additions**: `Img` (lazy-by-default image wrapper from task
  55.4), `FormField` (lightweight RHF-free form pairing).

### Reference port (read-only)

The original Figma-Make port at
`School Platform Design/src/app/components/ui/` is preserved untouched
as the visual source of truth. Consumers should import from
`@proctira/ui/components` only — never from the reference folder.

### Directional vs Non-Directional Icons (Task 48.3 / Requirement 18.10, 18.11)

A subset of the lucide-react icons we use carries an inherent left/right
semantic — e.g. `ChevronRight` literally points "forward". When a tenant
switches the active locale to RTL (Arabic, Hebrew, …), those icons must
mirror horizontally so the visual reading order still matches the
logical one. Other icons (`Search`, `User`, `Calendar`, `Bell`, `Mail`,
…) are direction-neutral and **must not** be flipped — mirroring them
breaks their meaning.

The `<DirectionalIcon>` wrapper, exported from `@proctira/ui/components`,
encapsulates this rule:

```tsx
import { ChevronRight } from 'lucide-react';
import { DirectionalIcon } from '@proctira/ui/components';
import { useLanguage } from '@/providers/LanguageProvider';

function NextLink() {
  const { dir } = useLanguage();
  // Mirrors automatically when dir === 'rtl'.
  return <DirectionalIcon icon={ChevronRight} dir={dir} aria-hidden />;
}
```

When the `dir` prop is omitted the wrapper falls back to
`document.documentElement.dir`, which `<LanguageProvider>` keeps in sync
with the active locale (Task 48.1). Pass `dir` explicitly only when the
component lives outside the provider tree (Storybook, isolated visual
regression tests).

#### When to use `<DirectionalIcon>` (directional icons)

Wrap any lucide icon whose meaning depends on the reading direction:

| Category            | Example icons                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Chevrons            | `ChevronRight`, `ChevronLeft`, `ChevronsRight`, `ChevronsLeft`                           |
| Arrows              | `ArrowRight`, `ArrowLeft`, `ArrowUpRight`, `ArrowDownLeft`, `ArrowBigRight`, `MoveRight` |
| Indent / Outdent    | `IndentIncrease`, `IndentDecrease`                                                       |
| Mail / Reply chains | `Reply`, `ReplyAll`, `Forward`                                                           |
| Corners             | `CornerDownRight`, `CornerUpRight`, `CornerDownLeft`, `CornerUpLeft`                     |
| Panels / Sidebars   | `PanelLeftOpen`, `PanelRightOpen`, `PanelLeftClose`, `PanelRightClose`                   |
| Skip controls       | `SkipForward`, `SkipBack`, `Rewind`, `FastForward`                                       |

The convention: **pick the LTR-correct icon (the one that points
"forward" in English) and let the wrapper mirror it for RTL.** Don't
hand-pick `ChevronLeft` for RTL builds — that drifts the LTR and RTL
markup apart and defeats the whole point of the wrapper.

#### When to bypass the wrapper (non-directional icons)

Render direction-neutral icons directly — **never** through
`<DirectionalIcon>`:

| Category          | Example icons                                          |
| ----------------- | ------------------------------------------------------ |
| Search / filter   | `Search`, `Filter`, `SlidersHorizontal`                |
| Identity          | `User`, `Users`, `UserCircle`, `UserPlus`              |
| Date / time       | `Calendar`, `Clock`, `Hourglass`                       |
| System            | `Bell`, `Settings`, `Globe`, `Sun`, `Moon`, `Monitor`  |
| Indicators        | `Check`, `X`, `Plus`, `Minus`, `AlertTriangle`, `Info` |
| Navigation chrome | `Menu`, `MoreHorizontal`, `MoreVertical`               |
| Actions           | `Download`, `Upload`, `Save`, `Edit`, `Trash`, `Copy`  |
| Auth / privacy    | `Lock`, `Unlock`, `Eye`, `EyeOff`, `Shield`            |
| Communication     | `Mail`, `Phone`, `MessageSquare`                       |
| Brand / favorites | `Star`, `Heart`, `Bookmark`                            |

These icons are visually symmetric or have no left/right semantic, so
mirroring them produces a backwards glyph that confuses screen readers
and breaks brand recognition. Render them with the lucide component
directly:

```tsx
import { Search, Bell, User } from 'lucide-react';

<button aria-label="Search">
  <Search className="h-5 w-5" aria-hidden="true" />
</button>;
```

#### Quick decision flow

1. Does the icon have an arrow, chevron, indent marker, or panel
   direction in its visual? → **wrap with `<DirectionalIcon>`**.
2. Otherwise → **render the lucide component directly**.

If you're unsure for a new icon, check the lucide gallery for its
LTR-equivalent: if there's a paired left/right variant (`ChevronLeft` ↔
`ChevronRight`), it's directional. If not, it's not.

### Primitives intentionally not migrated yet

The reference port ships ~45 primitives. Task 60.1 migrated the
canonical set actively used by `apps/web` plus additional commonly-used
shadcn primitives (Sheet, Popover, Tooltip, Accordion, Switch,
RadioGroup, ScrollArea, Skeleton, Separator, Avatar, Form, Command).
The following primitives from the reference port were **deferred** —
add them on demand when a feature first needs them:

`alert-dialog`, `aspect-ratio`, `breadcrumb`, `calendar`, `carousel`,
`chart`, `collapsible`, `context-menu`, `drawer` (vaul), `hover-card`,
`input-otp`, `menubar`, `navigation-menu`, `pagination`, `progress`,
`resizable`, `sidebar`, `slider`, `toggle`, `toggle-group`,
`use-mobile` (hook).

When a feature requires one of these, port it from
`School Platform Design/src/app/components/ui/<name>.tsx`, adapt
Tailwind v4 token shorthands to v3 (`bg-input-background` →
`bg-[hsl(var(--input))]`, `outline-hidden` → `outline-none`,
`rounded-xs` → `rounded`, `field-sizing-content` removed, etc.) and add
it to `packages/ui/components/src/<Name>.tsx` plus the `index.ts`
barrel.

## Reduced-Motion Strategy (Requirement 39.5 / Design §J)

Users with `prefers-reduced-motion: reduce` set on their OS expect the
platform to skip non-essential motion. The implementation has two layers:

### 1. `<MotionGate>` provider + `useMotionPreference()` consumer

Mount `<MotionGate>` near the application root (inside the existing
provider hierarchy described in `App.tsx`):

```tsx
import { MotionGate } from '@proctira/ui-motion-gate';

export function App() {
  return (
    <BrandConfigProvider>
      <LanguageProvider>
        <ThemeProvider>
          <MotionGate>{/* …rest of the tree… */}</MotionGate>
        </ThemeProvider>
      </LanguageProvider>
    </BrandConfigProvider>
  );
}
```

Inside any descendant, read the preference with the consumer hook:

```tsx
import { useMotionPreference } from '@proctira/ui-motion-gate';

function PulseDot() {
  const { disableMotion } = useMotionPreference();
  return (
    <span
      className={
        disableMotion
          ? 'bg-primary-500 size-2 rounded-full'
          : 'bg-primary-500 size-2 rounded-full motion-safe:animate-pulse'
      }
    />
  );
}
```

For lower-level subscriptions (e.g. inside a class component), you may use
the underlying hook `useReducedMotion()` directly:

```tsx
import { useReducedMotion } from '@proctira/ui-motion-gate';

const reduced = useReducedMotion(); // boolean, SSR-safe (false on server)
```

`<MotionGate>` exposes two escape hatches:

- `forceReduce` — disable motion regardless of OS preference (useful for
  storybook / QA).
- `forceMotion` — keep motion on regardless of OS preference. Reserved for
  _essential_ animations (loading bars, progress indicators); use sparingly.

### 2. Tailwind `motion-safe:*` and `motion-reduce:*` variants

Tailwind v3 (the version pinned in `apps/web/package.json`) and Tailwind v4
both ship the `motion-safe` and `motion-reduce` variants out of the box —
no plugin or config change is required. They map to:

- `motion-safe:` — applied when `prefers-reduced-motion: no-preference`
- `motion-reduce:` — applied when `prefers-reduced-motion: reduce`

**Convention:** every animated utility (`animate-*`, `transition-*`,
`duration-*`, `ease-*`, `transform`) MUST be wrapped with `motion-safe:`
unless the animation is essential. When you need a reduced-motion
fallback, pair it with a `motion-reduce:` rule rather than relying on the
absence of motion-safe.

```tsx
// ❌ Always animated, ignores user preference
<div className="animate-spin rounded-full" />

// ✅ Animation runs only when motion is allowed
<div className="motion-safe:animate-spin rounded-full" />

// ✅ With an explicit reduced-motion alternative
<div className="motion-safe:animate-pulse motion-reduce:opacity-60" />
```

The Tailwind variants and the `<MotionGate>` provider are complementary:

- Tailwind variants gate **CSS-defined** animations declaratively.
- `<MotionGate>` + `useMotionPreference()` gates **JavaScript-driven**
  animations (e.g. Motion / framer-motion, Recharts transitions, custom
  `requestAnimationFrame` loops) imperatively.

### 3. Where this is already applied

- `apps/web/src/RootRouter.tsx` — the global `LoadingFallback` spinner is
  gated behind `motion-safe:animate-spin`.
- `packages/ui/notification-bell` — the real-time pulse indicator reads
  `useMotionPreference()` and adds an
  `proctira-notification-bell__pulse--reduced-motion` modifier class so
  consumer styles can skip the pulse keyframe under reduced motion.

### 4. Testing

`useReducedMotion` is tested by mocking `window.matchMedia` to report
`prefers-reduced-motion: reduce` and verifying the hook returns `true`.
See `packages/ui/motion-gate/src/MotionGate.test.tsx` for the canonical
pattern. Reuse the `installMatchMediaMock` helper when writing tests for
new motion-aware components.

## Keyboard Contracts (Task 56.6 / Requirement 37 AC 6)

Every interactive primitive ships a per-component **keyboard contract**
documenting Tab/Shift+Tab order, arrow-key navigation, Enter/Space
activation, Escape dismissal, and Home/End jumps. Each contract sits
next to its source so it stays in lockstep with the implementation, and
each is exercised by a `*.keyboard.test.tsx` Vitest + Testing Library
suite.

| Component                         | Contract                                                                                                         | Tests                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `<Tabs>`                          | [`packages/ui/components/src/Tabs.keyboard.md`](./components/src/Tabs.keyboard.md)                               | `Tabs.keyboard.test.tsx`     |
| `<Dialog>`                        | [`packages/ui/components/src/Dialog.keyboard.md`](./components/src/Dialog.keyboard.md)                           | `Dialog.keyboard.test.tsx`   |
| `<Sheet>`                         | [`packages/ui/components/src/Sheet.keyboard.md`](./components/src/Sheet.keyboard.md)                             | `Sheet.keyboard.test.tsx`    |
| `<Command>` / Combobox            | [`packages/ui/components/src/Command.keyboard.md`](./components/src/Command.keyboard.md)                         | `Command.keyboard.test.tsx`  |
| `<DataGrid>`                      | [`packages/ui/data-grid/src/DataGrid.keyboard.md`](./data-grid/src/DataGrid.keyboard.md)                         | `DataGrid.keyboard.test.tsx` |
| `<Sidebar>` (apps/web)            | [`apps/web/src/components/layout/sidebar.keyboard.md`](../../apps/web/src/components/layout/sidebar.keyboard.md) | `sidebar.keyboard.test.tsx`  |
| `<MfaForm>` code input (apps/web) | [`apps/web/src/app/(auth)/mfa/mfa-form.keyboard.md`](<../../apps/web/src/app/(auth)/mfa/mfa-form.keyboard.md>)   | `mfa-form.keyboard.test.tsx` |

When you add a new interactive component or change an existing
keyboard model:

1. Update the contract markdown beside the component source.
2. Update or add the matching `.keyboard.test.tsx` so the contract is
   enforced in CI.
3. Cross-link the new contract from this table.
