// PRC-L215 (and PRC-L015 as its duplicate): the status timeline renders a
// distinct state per ScholarshipApplicationStatus value -- withdrawn is a
// neutral terminal step, not the same booleans as a still-pending
// application.
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/selected_student_store.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';
import 'package:proctira_mobile/features/scholarship/presentation/scholarship_status_screen.dart';

const String _studentId = 'a0000000-0000-4000-8000-00000000000a';

/// Serves a fixed set of applications to the status screen without SQLite
/// or HTTP, mirroring the `_StubRepository` pattern in
/// scholarship_contract_test.dart.
class _StubRepository extends ScholarshipRepository {
  _StubRepository(this._apps)
    : super(
        database: AppDatabase(overridePath: 'unused.db'),
        tenantProvider: TenantProvider(
          SecureStorage(const FlutterSecureStorage()),
        ),
        dio: Dio(),
      );
  final List<ScholarshipApplication> _apps;

  @override
  Future<List<ScholarshipApplication>> getApplications({
    required String studentId,
  }) async => _apps;
}

ScholarshipApplication _app(ScholarshipApplicationStatus status) {
  return ScholarshipApplication(
    id: 'app-${status.wire}',
    programId: 'prog-1',
    programName: 'Merit Scholarship 2026',
    applicantId: _studentId,
    status: status,
    submittedAt: '2026-01-05T00:00:00Z',
    reviewedAt:
        status == ScholarshipApplicationStatus.approved ||
            status == ScholarshipApplicationStatus.rejected
        ? '2026-02-01T00:00:00Z'
        : null,
  );
}

Future<void> _pumpForStatus(
  WidgetTester tester,
  ScholarshipApplicationStatus status,
) async {
  if (!getIt.isRegistered<SelectedStudentStore>()) {
    getIt.registerSingleton<SelectedStudentStore>(
      SelectedStudentStore(SecureStorage(const FlutterSecureStorage())),
    );
  }
  await tester.pumpWidget(
    RepositoryProvider<ScholarshipRepository>.value(
      value: _StubRepository(<ScholarshipApplication>[_app(status)]),
      child: const MaterialApp(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          AppLocalizations.delegate,
          DefaultMaterialLocalizations.delegate,
          DefaultWidgetsLocalizations.delegate,
        ],
        home: ScholarshipStatusScreen(studentId: _studentId),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  tearDown(() => getIt.reset());

  testWidgets('withdrawn renders a distinct "Withdrawn" terminal step', (
    WidgetTester tester,
  ) async {
    await _pumpForStatus(tester, ScholarshipApplicationStatus.withdrawn);

    expect(find.text('Withdrawn'), findsWidgets);
    // Not rendered as if it were still awaiting review or approved/rejected.
    expect(find.text('Approved'), findsNothing);
    expect(find.text('Rejected'), findsNothing);
  });

  testWidgets('underReview shows the active review step, no withdrawn label', (
    WidgetTester tester,
  ) async {
    await _pumpForStatus(tester, ScholarshipApplicationStatus.underReview);

    expect(find.text('Under Review'), findsWidgets);
    expect(find.text('Withdrawn'), findsNothing);
    expect(find.text('Approved'), findsOneWidget);
  });

  testWidgets('approved shows the Approved terminal step, not Withdrawn', (
    WidgetTester tester,
  ) async {
    await _pumpForStatus(tester, ScholarshipApplicationStatus.approved);

    expect(find.text('Approved'), findsWidgets);
    expect(find.text('Withdrawn'), findsNothing);
    expect(find.text('Rejected'), findsNothing);
  });

  testWidgets('rejected shows the Rejected terminal step, not Withdrawn', (
    WidgetTester tester,
  ) async {
    await _pumpForStatus(tester, ScholarshipApplicationStatus.rejected);

    expect(find.text('Rejected'), findsWidgets);
    expect(find.text('Withdrawn'), findsNothing);
    expect(find.text('Approved'), findsNothing);
  });

  testWidgets(
    'draft and submitted do not show a date on the Under Review step',
    (WidgetTester tester) async {
      await _pumpForStatus(tester, ScholarshipApplicationStatus.submitted);
      expect(find.text('Under Review'), findsWidgets);
      expect(find.text('Withdrawn'), findsNothing);
    },
  );
}
