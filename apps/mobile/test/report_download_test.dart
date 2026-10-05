import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/features/reports/presentation/report_detail_screen.dart';
import 'package:proctira_mobile/features/reports/presentation/reports_screen.dart';

class _FakeReportApi implements ReportApi {
  bool fail = false;

  @override
  Future<ReportSummary> getReportStatus(String reportId) async => ReportSummary(
    id: reportId,
    title: 'Term attendance',
    description: 'PDF',
    status: 'completed',
    format: 'pdf',
  );

  @override
  Future<Uint8List> downloadReport(String reportId) async {
    if (fail) throw const TransientApiException('boom', statusCode: 503);
    return Uint8List.fromList(<int>[37, 80, 68, 70]);
  }

  @override
  Future<List<ReportSummary>> listReports({
    int page = 1,
    int pageSize = 20,
  }) async => const <ReportSummary>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// PRC-M045: downloads are saved; placeholder quick reports are hidden.
void main() {
  late _FakeReportApi api;
  setUp(() {
    api = _FakeReportApi();
    getIt
      ..registerSingleton<ConnectivityMonitor>(
        FakeConnectivityMonitor(startsOnline: true),
      )
      ..registerSingleton<ReportApi>(api);
  });
  tearDown(() => getIt.reset());

  testWidgets('completed report download triggers the save callback', (
    WidgetTester tester,
  ) async {
    final List<String> saved = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: ReportDetailScreen(
          id: 'rep-1',
          saveFile: (String id, Uint8List bytes) async {
            saved.add('$id:${bytes.length}');
            return '/private/$id.pdf';
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download Report'));
    await tester.pumpAndSettle();
    expect(saved, <String>['rep-1:4']);
    expect(find.text('Report saved to this device.'), findsOneWidget);
    expect(find.textContaining('bytes'), findsNothing);
  });

  testWidgets('failed download shows a safe error and stays retryable', (
    WidgetTester tester,
  ) async {
    api.fail = true;
    await tester.pumpWidget(
      MaterialApp(
        home: ReportDetailScreen(
          id: 'rep-1',
          saveFile: (String id, Uint8List bytes) async => '',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download Report'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Exception'), findsNothing);
    final FilledButton button = tester.widget<FilledButton>(
      find.ancestor(
        of: find.text('Download Report'),
        matching: find.byWidgetPredicate((Widget w) => w is FilledButton),
      ),
    );
    expect(button.onPressed, isNotNull);
  });

  testWidgets('no placeholder quick reports in default builds', (
    WidgetTester tester,
  ) async {
    expect(ReportsScreen.showPreviewReports, isFalse);
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          routes: <RouteBase>[
            GoRoute(path: '/', builder: (_, _) => const ReportsScreen()),
            GoRoute(
              path: '/reports/:id',
              builder: (_, GoRouterState s) =>
                  ReportDetailScreen(id: s.pathParameters['id']!),
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Quick reports'), findsNothing);
    expect(find.text('Attendance summary'), findsNothing);

    await tester.pumpWidget(
      const MaterialApp(home: ReportDetailScreen(id: 'attendance-summary')),
    );
    await tester.pumpAndSettle();
    expect(find.text('—'), findsNothing);
  });
}
