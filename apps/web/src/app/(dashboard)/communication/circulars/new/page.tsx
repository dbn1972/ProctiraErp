import { requireSession } from '@/lib/auth/server';
import { listInstitutions } from '@/lib/api/institutions';
import { listTenantRoles } from '@/lib/api/admin.server';
import { loadStaffDirectory, loadStudentDirectory } from '@/lib/load-entity-labels';
import { listClassesByInstitution } from '@/lib/institutions/api';
import { formatCodeNameLabel, type EntityLabelOption } from '@/lib/entity-label';
import { toNamedOptions } from '@/lib/communication/named-options';

import { NewCircularForm } from '../../_components/new-circular-form';

export const dynamic = 'force-dynamic';

export default async function NewCircularPage() {
  const session = await requireSession();
  const [students, staff, institutions, rolesResult] = await Promise.all([
    loadStudentDirectory(),
    loadStaffDirectory(),
    listInstitutions({ pageSize: 20 }).catch(() => []),
    listTenantRoles().catch(() => ({ roles: [], source: 'scaffold' as const })),
  ]);
  const classGroups = await Promise.all(
    institutions.slice(0, 5).map(async (institution) => {
      try {
        return await listClassesByInstitution(institution.id);
      } catch {
        return [];
      }
    }),
  );

  const people: EntityLabelOption[] = [...students.options, ...staff.options];
  const peopleTotal = students.total + staff.total;
  const institutionOptions = toNamedOptions(institutions);
  const classOptions = toNamedOptions(
    classGroups.flat().map((row) => ({ id: row.id, name: row.name })),
  );
  const roleOptions: EntityLabelOption[] = rolesResult.roles.map((role) => ({
    id: role.id,
    label: formatCodeNameLabel(null, role.name) || role.name,
    searchText: role.name,
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New circular</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft a circular. Send it after review; acknowledgements are tracked per recipient.
        </p>
      </div>
      <NewCircularForm
        createdBy={session.user.sub}
        people={people}
        peopleTotal={peopleTotal}
        roleOptions={roleOptions}
        classOptions={classOptions}
        institutionOptions={institutionOptions}
      />
    </div>
  );
}
