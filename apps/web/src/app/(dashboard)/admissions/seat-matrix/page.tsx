import { LookupLoadError } from '@/components/route-state/lookup-load-error';
import { listSeatMatrix } from '@/lib/api/admissions';
import { loadAdmissionsLookups, pickSelectedLookup } from '@/lib/admissions/lookups';
import { AdmissionsChrome } from '../_components/admissions-chrome';
import { SeatMatrixPanel } from '../_components/seat-matrix-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdmissionsSeatMatrixPage(props: PageProps) {
  const searchParams = (await props.searchParams) ?? {};
  const { institutions, periods, grades, errors } = await loadAdmissionsLookups();
  // PRC-M070: the matrix reflects the selected institution, not always [0].
  const institutionId = pickSelectedLookup(institutions, searchParams['institutionId']);
  const rows = await listSeatMatrix(institutionId ? { institutionId } : undefined);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Seat matrix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Category / reservation seats per institution, academic period, and grade. Filled counts
          come from accepted offers on the same category key.
        </p>
      </div>
      <LookupLoadError failed={errors} />
      <AdmissionsChrome current="/admissions/seat-matrix">
        {institutions.length > 1 ? (
          <form
            method="get"
            action="/admissions/seat-matrix"
            className="mb-4 flex flex-wrap items-end gap-3"
            aria-label="Filter seat matrix"
            data-testid="seat-matrix-filter"
          >
            <label className="flex min-w-[14rem] flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Institution</span>
              <select
                name="institutionId"
                defaultValue={institutionId}
                className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {institutions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex h-11 min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              Show matrix
            </button>
          </form>
        ) : null}
        <SeatMatrixPanel
          institutions={institutions}
          periods={periods}
          grades={grades}
          rows={rows}
        />
      </AdmissionsChrome>
    </div>
  );
}
