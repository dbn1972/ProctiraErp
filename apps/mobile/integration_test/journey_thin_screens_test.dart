/// Integration coverage for thin-screen residuals (tenant directory label +
/// enrollment summary report shortcut) when a device/emulator is available.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';

import 'helpers/test_setup.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'reports route surfaces enrollment summary shortcut',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'demo-school',
        tenantDisplayName: 'Demo School',
      );
      addTearDown(harness.dispose);
      await harness.markAuthenticated();

      await pumpJourneyApp(tester);
      _go(tester, '/reports');
      await tester.pumpAndSettle();

      expect(find.text('Enrollment summary'), findsOneWidget);
      expect(find.text('Attendance summary'), findsOneWidget);
    },
  );

  testWidgets(
    'tenant selection keeps manual workspace ID field',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'demo-school',
        tenantDisplayName: 'Demo School',
      );
      addTearDown(harness.dispose);
      await harness.markAuthenticated();

      await pumpJourneyApp(tester);
      _go(tester, '/tenant');
      await tester.pumpAndSettle();

      expect(find.text('Workspace ID'), findsOneWidget);
      expect(find.byType(TextFormField), findsWidgets);
    },
  );
}

void _go(WidgetTester tester, String location) {
  final BuildContext context =
      tester.element(find.byType(MaterialApp).first);
  GoRouter.of(context).go(location);
}
