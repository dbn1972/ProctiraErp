# Auth dark-mode background fix — duplicate discovery note

PR #436 (`fix(a11y): auth shells ignore dark mode, stay on a hardcoded white bg`,
merged as `ef582c1f`) fixed `apps/web/src/app/(auth)/_components/auth-shell.tsx`
and `apps/web/src/app/(auth)/login/page.tsx`'s `bg-white` → `bg-background`.

While rebasing PR #382 (V12 QA matrix coverage) onto main after #436 merged, its
own commit `0e7f90a2` (`test(web): make the Volume 12 device/theme matrix
execute, and fix what it found`, authored **before** #436, as part of turning on
a dark-mode axe scan that had been silently no-op'ing) turned out to already
contain the identical fix to both files, plus a third file `#436` never checked:
`apps/web/src/app/(auth)/layout.tsx` (`bg-slate-50` → `bg-background`), and the
actual root cause of why the dark-mode matrix wasn't catching any of this
sooner: `setTheme()` wrote `data-theme` directly, and `ThemeProvider`'s mount
effect silently overwrote it from `prefers-color-scheme` a few seconds later, so
every test labelled `[dark]` was scanning the light theme the whole time.

Net effect: no regression, no lost work, no conflicting values — both branches
independently landed on the exact same `bg-background` line for the two shared
files, and the merge of #382 onto post-#436 main resolved as a clean pick of
either side's identical code plus #382's more detailed comment. #382's fix is
the more complete of the two (three files vs. two, plus the theme-provider root
cause); #436 was redundant once #382's history was visible, which it was not at
the time #436 was investigated and opened.

Recorded here rather than silently reconciled because two independently-authored
fixes landing on the same lines in the same night is worth a trail, even though
neither caused harm.
