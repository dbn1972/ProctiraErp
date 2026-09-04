import { listPayStructures } from '@/lib/api/payroll';

export const dynamic = 'force-dynamic';

export default async function PayrollPage() {
  const rows = await listPayStructures();
  return (
    <section className="space-y-6" aria-labelledby="payroll-heading">
      <div>
        <h1 id="payroll-heading" className="text-3xl font-extrabold tracking-tight">
          Payroll
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 24 MVP — PayStructure list
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="p-3">ID</th>
              <th className="p-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={2}>
                  No records yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border">
                  <td className="p-3 font-mono text-xs">{row.id.slice(0, 8)}</td>
                  <td className="p-3 font-mono text-xs">{JSON.stringify(row).slice(0, 140)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
