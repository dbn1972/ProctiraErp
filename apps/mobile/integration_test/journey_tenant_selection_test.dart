import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/features/students/data/student_repository.dart';

import 'helpers/test_setup.dart';

/// PRC-M567: tenant (workspace) selection screen journeys.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('first run: workspace is required, then sign-in is next', (
    WidgetTester tester,
  ) async {
    final JourneyHarness harness = await bootstrapTestApp();
    addTearDown(harness.dispose);
    await harness.bootstrapAuth();
    await pumpJourneyApp(tester);
    expect(currentJourneyPath(), '/tenant');

    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Workspace ID is required'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Workspace ID'),
      'tenant-x',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pumpAndSettle();

    expect(harness.tenantProvider.tenantId, 'tenant-x');
    expect(currentJourneyPath(), '/login');
  });

  testWidgets(
    'switching workspace wipes prior-tenant caches and requires sign-in',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-a',
        tenantDisplayName: 'Tenant A',
        initialSecureStorage: <String, String>{
          'auth.access_token': 'access-a',
          'auth.refresh_token': 'refresh-a',
        },
      );
      addTearDown(harness.dispose);
      await harness.bootstrapAuth();
      await tester.runAsync(
        () => getIt<StudentRepository>().cacheStudent(
          const Student(
            id: 'stu-a-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            nationalId: 'A1',
            institutionId: 'inst-a',
            dateOfBirth: '2015-01-01',
            gender: 'F',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          ),
        ),
      );
      expect(await tableRowCount(harness.database, 'students_cache'), 1);

      await pumpJourneyApp(tester);
      goJourney('/tenant?switch=1');
      await tester.pumpAndSettle();
      expect(currentJourneyPath(), '/tenant');

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Workspace ID'),
        'tenant-b',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Switch workspace'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pumpAndSettle();

      expect(harness.tenantProvider.tenantId, 'tenant-b');
      expect(await tableRowCount(harness.database, 'students_cache'), 0);
      expect(await getIt<SecureStorage>().readAccessToken(), isNull);
      expect(harness.authBloc.state.isAuthenticated, isFalse);
      expect(currentJourneyPath(), '/login');
    },
  );
}
