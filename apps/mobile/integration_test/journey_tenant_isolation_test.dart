import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';
import 'package:openemis_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite/sqflite.dart';

import 'helpers/test_setup.dart';

/// Verifies that switching the active tenant scopes which cached rows are
/// visible to the UI. Even though both tenants share the same SQLite file
/// (one device, multiple tenants) the `tenant_id` column on every cache
/// table acts as the isolation boundary, mirroring the server-side
/// row-level security.
///
/// 1. Seed two students under `tenant-a` and `tenant-b`.
/// 2. Activate tenant A → the students screen shows Ada and not Brent.
/// 3. Switch to tenant B via [TenantProvider.setTenant] → only Brent shows.
///
/// Validates: Requirements 4.7
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'tenant switch isolates cached student rows on /students',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-a',
        tenantDisplayName: 'Tenant A',
      );
      addTearDown(harness.dispose);

      await harness.markAuthenticated();

      // Seed one student under each tenant.
      final Database raw = await harness.database.database;
      await raw.insert('students_cache', <String, Object?>{
        'id': 'stu-a-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-a',
        'full_name': 'Ada Lovelace',
        'national_id': 'A1',
        'grade': null,
        'class_name': null,
        'payload': jsonEncode(<String, dynamic>{
          'id': 'stu-a-1',
          'firstName': 'Ada',
          'lastName': 'Lovelace',
          'institutionId': 'inst-a',
        }),
        'updated_at': 1,
      });
      await raw.insert('students_cache', <String, Object?>{
        'id': 'stu-b-1',
        'tenant_id': 'tenant-b',
        'institution_id': 'inst-b',
        'full_name': 'Brent Hopper',
        'national_id': 'B1',
        'grade': null,
        'class_name': null,
        'payload': jsonEncode(<String, dynamic>{
          'id': 'stu-b-1',
          'firstName': 'Brent',
          'lastName': 'Hopper',
          'institutionId': 'inst-b',
        }),
        'updated_at': 1,
      });

      await pumpJourneyApp(tester);
      _go(tester, '/students');
      await tester.pumpAndSettle();

      // Tenant A view: Ada is visible, Brent is not.
      expect(find.text('Ada Lovelace'), findsOneWidget);
      expect(find.text('Brent Hopper'), findsNothing);

      // Switch to tenant B via the provider. Re-pumping the screen forces
      // a fresh `searchStudents` query under the new tenant id.
      final TenantProvider tenant = harness.tenantProvider;
      await tenant.setTenant(
        tenantId: 'tenant-b',
        displayName: 'Tenant B',
      );

      _go(tester, '/');
      await tester.pumpAndSettle();
      _go(tester, '/students');
      await tester.pumpAndSettle();

      // Tenant B view: Brent is visible, Ada is not.
      expect(find.text('Brent Hopper'), findsOneWidget);
      expect(find.text('Ada Lovelace'), findsNothing);
    },
  );
}

void _go(WidgetTester tester, String location) {
  final BuildContext context =
      tester.element(find.byType(MaterialApp).first);
  GoRouter.of(context).go(location);
}
