import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sqflite/sqflite.dart';

import 'helpers/test_setup.dart';

/// Validates that tapping a cached notification deep-links to the route
/// produced by [NotificationRouter.routeFor].
///
/// The cache is seeded with a single REPORT_READY notification carrying an
/// `entityId`. Tapping the row should:
///   * mark the notification as read,
///   * route the user to `/reports/<entityId>` (the report-detail screen).
///
/// Validates: Requirements 22.1 (push notification routing)
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'notification tap deep-links to type-mapped route',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-a',
        tenantDisplayName: 'Tenant A',
      );
      addTearDown(harness.dispose);

      await harness.markAuthenticated();

      // Seed one REPORT_READY notification with an entityId. When tapped
      // the router should send the user to /reports/<id>.
      final Database raw = await harness.database.database;
      final Map<String, dynamic> payload = <String, dynamic>{
        'type': 'REPORT_READY',
        'entityId': 'enrollment-summary',
      };
      await raw.insert('notifications_cache', <String, Object?>{
        'id': 'notif-1',
        'tenant_id': 'tenant-a',
        'type': 'REPORT_READY',
        'title': 'Your report is ready',
        'body': 'The enrollment summary report has finished generating.',
        'payload': jsonEncode(payload),
        'received_at': DateTime.now().millisecondsSinceEpoch,
        'read': 0,
      });

      await pumpJourneyApp(tester);
      _go(tester, '/notifications');
      await tester.pumpAndSettle();

      // The seeded notification renders.
      expect(find.text('Your report is ready'), findsOneWidget);

      // Tap the notification row.
      await tester.tap(find.text('Your report is ready'));
      await tester.pumpAndSettle();

      // The router has navigated to /reports/enrollment-summary, which
      // renders the report detail screen.
      final BuildContext routerContext =
          tester.element(find.byType(MaterialApp).first);
      final GoRouter router = GoRouter.of(routerContext);
      expect(
        router.routerDelegate.currentConfiguration.uri.toString(),
        '/reports/enrollment-summary',
      );

      // The notification row was marked as read in the cache.
      final List<Map<String, Object?>> rows = await raw.query(
        'notifications_cache',
        where: 'id = ?',
        whereArgs: <Object>['notif-1'],
      );
      expect(rows, hasLength(1));
      expect(rows.first['read'], 1);
    },
  );
}

void _go(WidgetTester tester, String location) {
  final BuildContext context =
      tester.element(find.byType(MaterialApp).first);
  GoRouter.of(context).go(location);
}
