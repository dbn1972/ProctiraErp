/**
 * H-D1-R3 — the Hostel and Transport nav entries (`hostel.read` /
 * `transport.read`, sidebar.tsx + CommandPalette.tsx) follow the roles the
 * gateway serves, not the full staff list.
 */
import { describe, expect, it } from 'vitest';
import { permissionsForRoles } from './role-permissions';

const HOSTEL_STAFF = [
  'warden',
  'hostel_warden',
  'hostel-warden',
  'hostel_manager',
  'hostel-manager',
  'hostel_admin',
  'hostel-admin',
  'hostel_clerk',
];
const TRANSPORT_STAFF = [
  'transport_officer',
  'transport-officer',
  'transport_manager',
  'transport-manager',
  'fleet_manager',
  'fleet-manager',
  'transport_admin',
  'transport-admin',
];

describe('campus nav permissions (H-D1-R3)', () => {
  it('shows Hostel (not Transport) to every hostel staff role', () => {
    for (const role of HOSTEL_STAFF) {
      const permissions = permissionsForRoles([role]);
      expect(permissions, role).toContain('hostel.read');
      expect(permissions, role).not.toContain('transport.read');
    }
  });

  it('shows Transport (not Hostel) to every transport staff role', () => {
    for (const role of TRANSPORT_STAFF) {
      const permissions = permissionsForRoles([role]);
      expect(permissions, role).toContain('transport.read');
      expect(permissions, role).not.toContain('hostel.read');
    }
  });

  it('shows both to the registrar, read only, and keeps its attendance grants', () => {
    const permissions = permissionsForRoles(['registrar']);
    expect(permissions).toEqual(expect.arrayContaining(['hostel.read', 'transport.read']));
    expect(permissions).toEqual(expect.arrayContaining(['student.read', 'attendance.approve']));
    for (const write of ['create', 'update', 'delete', 'manage']) {
      expect(permissions).not.toContain(`hostel.${write}`);
      expect(permissions).not.toContain(`transport.${write}`);
    }
  });

  it('hides Hostel and Transport from teacher, staff and portal roles', () => {
    for (const role of ['teacher', 'staff', 'student', 'parent', 'guardian', 'nurse']) {
      const permissions = permissionsForRoles([role]);
      expect(permissions, role).not.toContain('hostel.read');
      expect(permissions, role).not.toContain('transport.read');
    }
  });

  it('shows the module to a multi-role session holding one of the staff roles', () => {
    expect(permissionsForRoles(['teacher', 'transport_officer'])).toContain('transport.read');
    expect(permissionsForRoles(['student', 'warden'])).toContain('hostel.read');
  });
});
