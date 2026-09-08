/**
 * Thin Help destination for MobileShell (G-404).
 * Resolves `/help` so drawer links are not dead.
 */
import Link from 'next/link';

import { DocumentTitle } from '@/components/DocumentTitle';

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-8" data-testid="help-page">
      <DocumentTitle pageTitle="Help" />
      <h1 className="text-2xl font-semibold text-foreground">Help</h1>
      <p className="text-muted-foreground">
        Operator runbooks and module guides live in the docs tree. For day-to-day
        tasks, use the sidebar modules or the command palette (⌘K).
      </p>
      <ul className="list-disc space-y-2 pl-5 text-sm text-foreground">
        <li>
          <Link className="underline" href="/">
            Dashboard home
          </Link>
        </li>
        <li>
          <Link className="underline" href="/admin">
            Administration
          </Link>
        </li>
        <li>
          <Link className="underline" href="/reports">
            Reports
          </Link>
        </li>
      </ul>
    </div>
  );
}
