/**
 * Staff dunning / reminder console (F2) — overdue feed, suppressions, sandbox send audit.
 */
import Link from 'next/link';

import { requireSession } from '@/lib/auth/server';
import {
  listOverdueReminders,
  listReminderSendAudits,
  listReminderSuppressions,
} from '@/lib/api/fees';
import { DunningConsole } from '../_components/dunning-console';

export const dynamic = 'force-dynamic';

export default async function FeesDunningPage() {
  await requireSession();
  const [overdue, suppressions, auditPayload] = await Promise.all([
    listOverdueReminders(),
    listReminderSuppressions(),
    listReminderSendAudits(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/fees" className="underline-offset-4 hover:underline">
            Fees
          </Link>
          <span aria-hidden="true"> / </span>
          Dunning
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Dunning / reminders
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operator console over the overdue reminder feed. Sandbox email/SMS honesty only — not a
          live Twilio claim.
        </p>
      </div>
      <DunningConsole
        overdue={overdue.data}
        asOf={overdue.asOf}
        suppressions={suppressions}
        audits={auditPayload.data}
        honestyNote={auditPayload.honestyNote}
      />
    </div>
  );
}
