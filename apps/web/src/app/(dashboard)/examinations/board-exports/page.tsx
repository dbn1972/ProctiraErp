/**
 * Board compliance export packs (WS4) — CBSE / ICSE / MH-STATE.
 * Route: /examinations/board-exports
 */
import Link from 'next/link';

import { BoardExportTriggerForm } from '@/components/examinations/board-export-trigger-form';
import { listBoardExportJobs, listBoardPacks, listGradebookBoards } from '@/lib/api/gradebook';

export const dynamic = 'force-dynamic';

export default async function BoardExportsPage() {
  const [packs, boards, jobs] = await Promise.all([
    listBoardPacks(),
    listGradebookBoards(),
    listBoardExportJobs(),
  ]);

  const apiDown = !packs.ok || !boards.ok || !jobs.ok;
  const errorMsg = [packs, boards, jobs]
    .filter((r) => !r.ok)
    .map((r) => (!r.ok ? r.error : ''))
    .filter(Boolean)
    .join(' · ');

  return (
    <section aria-labelledby="board-exports-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/examinations" className="hover:underline">
              Examinations
            </Link>{' '}
            / Board exports
          </p>
          <h1
            id="board-exports-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Board export packs
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Generate CBSE, ICSE, and MH-STATE marksheet / exam result packs from live gradebook
            data. Incomplete required subjects return HTTP 422.
          </p>
        </div>
      </div>

      {apiDown ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          role="status"
        >
          Board export API unavailable: {errorMsg || 'gateway error'}. Ensure{' '}
          <code className="text-xs">DATABASE_URL</code> and SIS schema seeds are applied.
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Registered packs</h2>
        {packs.ok && packs.data.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {packs.data.map((pack) => (
              <li key={pack.code} className="px-4 py-3 text-sm">
                <div className="font-semibold">
                  {pack.code} · v{pack.version}
                </div>
                <div className="text-muted-foreground">{pack.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  Required: {pack.requiredSubjects.join(', ')}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No pack registry loaded.</p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Generate pack</h2>
        <BoardExportTriggerForm />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Recent jobs</h2>
        {jobs.ok && jobs.data.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border">
            <table
              className="w-full min-w-[640px] text-left text-sm"
              aria-label="Board export jobs"
            >
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 font-semibold">Job</th>
                  <th className="px-3 py-2 font-semibold">Board</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Candidates</th>
                  <th className="px-3 py-2 font-semibold">Download</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.map((job) => {
                  const boardCode =
                    typeof job.metadata?.boardCode === 'string' ? job.metadata.boardCode : '—';
                  const count =
                    typeof job.metadata?.candidateCount === 'number'
                      ? job.metadata.candidateCount
                      : '—';
                  const checksum =
                    typeof job.metadata?.checksumSha256 === 'string'
                      ? job.metadata.checksumSha256.slice(0, 10)
                      : null;
                  return (
                    <tr key={job.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{job.id.slice(0, 8)}…</td>
                      <td className="px-3 py-2">{boardCode}</td>
                      <td className="px-3 py-2">{job.status}</td>
                      <td className="px-3 py-2">
                        {count}
                        {checksum ? (
                          <span className="ms-2 font-mono text-xs text-muted-foreground">
                            {checksum}…
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {job.status === 'SUCCEEDED' ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {job.artifactUri?.split('/').slice(-2).join('/') ?? '—'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No marksheet pack jobs yet. Generate one above.
          </p>
        )}
      </div>

      {boards.ok && boards.data.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Tenant boards: {boards.data.map((b) => b.code).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
