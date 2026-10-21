// PRC-M567: widget-level coverage for ReportsScreen (the list screen, as
// opposed to ReportDetailScreen which report_download_test.dart covers).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/features/reports/presentation/report_detail_screen.dart';
import 'package:proctira_mobile/features/reports/presentation/reports_screen.dart';

class _FakeReportApi implements ReportApi {
  List<ReportSummary> reports = const <ReportSummary>[];

  @override
  Future<List<ReportSummary>> listReports({
    int page = 1,
    int pageSize = 20,
  }) async => reports;

  @override
  Future<ReportSummary> getReportStatus(String reportId) async {
    return reports.firstWhere((ReportSummary r) => r.id == reportId);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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

  testWidgets('predefined report tiles render in preview builds only', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: ReportsScreen()));
    await tester.pumpAndSettle();

    // Default (non-preview) build: no predefined "Quick reports" section.
    expect(ReportsScreen.showPreviewReports, isFalse);
    expect(find.text('Quick reports'), findsNothing);
    expect(find.text('Attendance summary'), findsNothing);
  });

  testWidgets('generated report tiles render and tapping one navigates to '
      'ReportDetailScreen with the correct id', (WidgetTester tester) async {
    api.reports = <ReportSummary>[
      const ReportSummary(
        id: 'rep-1',
        title: 'Term attendance',
        description: 'PDF export',
        status: 'completed',
        format: 'pdf',
      ),
    ];

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

    expect(find.text('Term attendance'), findsOneWidget);

    await tester.tap(find.text('Term attendance'));
    await tester.pumpAndSettle();

    expect(
      find.byWidgetPredicate(
        (Widget w) => w is ReportDetailScreen && w.id == 'rep-1',
      ),
      findsOneWidget,
    );
  });

  testWidgets('empty generated reports show an informative empty state', (
    WidgetTester tester,
  ) async {
    api.reports = const <ReportSummary>[];

    await tester.pumpWidget(const MaterialApp(home: ReportsScreen()));
    await tester.pumpAndSettle();

    expect(find.text('No generated reports available.'), findsOneWidget);
  });
}
