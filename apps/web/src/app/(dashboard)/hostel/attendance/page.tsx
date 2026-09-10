import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

import { requireSession } from '@/lib/auth/server';
import { listHostelAttendance, listHostelBlocks } from '@/lib/api/hostel';
import { HostelAttendanceForm } from '../_components/attendance-form';

export const dynamic = 'force-dynamic';

export default async function HostelAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ blockId?: string; onDate?: string }>;
}) {
  await requireSession();
  const { blockId, onDate } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = onDate && onDate.length >= 10 ? onDate.slice(0, 10) : today;
  const blocks = await listHostelBlocks();
  const selectedBlock = blockId && blocks.some((b) => b.id === blockId) ? blockId : blocks[0]?.id;
  const marks = selectedBlock && date ? await listHostelAttendance(selectedBlock, date) : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Hostel attendance
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Night roll call per block per date. Upsert is idempotent.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <HostelAttendanceForm blocks={blocks} defaultBlockId={selectedBlock} defaultDate={date} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roll for {date}</CardTitle>
          <CardDescription>
            {marks.length === 0
              ? 'No marks for this block and date.'
              : `${marks.length} mark${marks.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {marks.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No marks for this block and date.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {marks.map((mark) => (
                <li
                  key={mark.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="hostel-attendance-row"
                >
                  <p className="text-sm font-medium text-foreground">{mark.status}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    student {mark.studentId.slice(0, 8)}
                    {mark.reason ? ` · ${mark.reason}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
