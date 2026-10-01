// PRC-H015: mobile scholarship models parse the backend's real payloads.
// Fixtures: test/fixtures/scholarship (see README there for route sources).
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/selected_student_store.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';
import 'package:proctira_mobile/features/scholarship/presentation/scholarship_status_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const String _studentA = 'a0000000-0000-4000-8000-00000000000a';
const String _studentB = 'b0000000-0000-4000-8000-00000000000b';

Map<String, dynamic> _fixture(String name) =>
    jsonDecode(File('test/fixtures/scholarship/$name').readAsStringSync())
        as Map<String, dynamic>;

List<Map<String, dynamic>> _rows(String name) =>
    (_fixture(name)['data'] as List<dynamic>).cast<Map<String, dynamic>>();

/// Serves fixtures by path; records query parameters.
class _FixtureAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final String file = options.path.endsWith('/programs')
        ? 'staff_programs.json'
        : 'staff_applications.json';
    return ResponseBody.fromString(
      jsonEncode(_fixture(file)),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Serves fixed applications to the status screen without SQLite / HTTP.
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  group('programs', () {
    test('staff payload parses (no provider/isOpen/deadline keys)', () {
      final List<ScholarshipProgram> programs = _rows(
        'staff_programs.json',
      ).map(ScholarshipProgram.fromJson).toList();
      final ScholarshipProgram merit = programs[0];
      expect(merit.name, 'Merit Scholarship 2026');
      expect(merit.description, '');
      expect(merit.provider, isNull);
      expect(merit.amount, 25000);
      expect(merit.currency, 'INR');
      expect(merit.deadline, '2099-03-31');
      expect(merit.isOpen, isTrue);
      expect(merit.acceptsApplications, isTrue);
      expect(merit.requiredDocuments, <String>[
        'transcript',
        'income_certificate',
      ]);

      final ScholarshipProgram sports = programs[1];
      expect(sports.isOpen, isFalse);
      expect(sports.amount, 10000.5);
      expect(sports.acceptsApplications, isFalse);
    });

    test('parent payload parses', () {
      final ScholarshipProgram p = ScholarshipProgram.fromJson(
        _rows('parent_programs.json').single,
      );
      expect(p.deadline, '2099-03-31');
      expect(p.isOpen, isTrue);
      expect(p.requiredDocuments, <String>['transcript']);
    });

    test('cache round-trip keeps openness, deadline and amount', () {
      final ScholarshipProgram original = ScholarshipProgram.fromJson(
        _rows('staff_programs.json')[1],
      );
      final ScholarshipProgram cached = ScholarshipProgram.fromJson(
        original.toJson(),
      );
      expect(cached.isOpen, isFalse);
      expect(cached.deadline, original.deadline);
      expect(cached.amount, original.amount);
    });
  });

  group('applications', () {
    test(
      'staff payload parses applicantId, snake_case status, doc objects',
      () {
        final ScholarshipApplication a = ScholarshipApplication.fromJson(
          _rows('staff_applications.json')[0],
        );
        expect(a.applicantId, _studentA);
        expect(a.status, ScholarshipApplicationStatus.underReview);
        expect(a.status.displayName, 'Under Review');
        expect(a.documents, <String>['transcript.pdf']);
        expect(a.programName, isNull);

        final ScholarshipApplication b = ScholarshipApplication.fromJson(
          _rows('staff_applications.json')[1],
        );
        expect(b.status, ScholarshipApplicationStatus.approved);
        expect(b.reviewerNotes, 'Meets criteria');
      },
    );

    test('parent payload parses', () {
      final ScholarshipApplication a = ScholarshipApplication.fromJson(
        _rows('parent_applications.json').single,
      );
      expect(a.applicantId, _studentA);
      expect(a.status, ScholarshipApplicationStatus.underReview);
    });

    test('unknown status is explicit, not draft', () {
      expect(
        ScholarshipApplicationStatus.fromWire('escalated'),
        ScholarshipApplicationStatus.unknown,
      );
      expect(
        ScholarshipApplicationStatus.fromWire(null),
        ScholarshipApplicationStatus.unknown,
      );
      expect(ScholarshipApplicationStatus.underReview.toWire(), 'under_review');
      // Rows cached by older builds used the enum name.
      expect(
        ScholarshipApplicationStatus.fromWire('underReview'),
        ScholarshipApplicationStatus.underReview,
      );
    });
  });

  group('repository', () {
    Future<
      ({ScholarshipRepository repo, _FixtureAdapter adapter, AppDatabase db})
    >
    build() async {
      final Directory dir = await Directory.systemTemp.createTemp('schol_');
      final AppDatabase db = AppDatabase(overridePath: '${dir.path}/o.db');
      final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
      await secure.writeTenant(tenantId: 'tenant-a', displayName: 'A');
      final TenantProvider tenant = TenantProvider(secure);
      await tenant.bootstrap();
      final _FixtureAdapter adapter = _FixtureAdapter();
      final Dio dio = Dio(BaseOptions(baseUrl: 'https://api.test'))
        ..httpClientAdapter = adapter;
      return (
        repo: ScholarshipRepository(
          database: db,
          tenantProvider: tenant,
          dio: dio,
        ),
        adapter: adapter,
        db: db,
      );
    }

    test(
      'lists by applicantId and never returns another student\'s rows',
      () async {
        final ctx = await build();
        final List<ScholarshipApplication> apps = await ctx.repo
            .getApplications(studentId: _studentA);

        final RequestOptions listCall = ctx.adapter.requests.firstWhere(
          (RequestOptions r) => r.path.endsWith('/applications'),
        );
        expect(listCall.queryParameters['applicantId'], _studentA);
        expect(listCall.queryParameters.containsKey('studentId'), isFalse);

        expect(apps, hasLength(1));
        expect(apps.single.applicantId, _studentA);
        expect(
          apps.any((ScholarshipApplication a) => a.applicantId == _studentB),
          isFalse,
        );
        // Program name joined from the catalog.
        expect(apps.single.programName, 'Merit Scholarship 2026');
        await ctx.db.close();
      },
    );

    test(
      'programs list parses the live contract instead of erroring',
      () async {
        final ctx = await build();
        final List<ScholarshipProgram> programs = await ctx.repo.getPrograms(
          openOnly: false,
        );
        expect(programs, hasLength(2));
        expect(programs.first.deadline, '2099-03-31');
        await ctx.db.close();
      },
    );
  });

  testWidgets('under_review application renders "Under Review"', (
    WidgetTester tester,
  ) async {
    if (!getIt.isRegistered<SelectedStudentStore>()) {
      getIt.registerSingleton<SelectedStudentStore>(
        SelectedStudentStore(SecureStorage(const FlutterSecureStorage())),
      );
    }
    final ScholarshipApplication app = ScholarshipApplication.fromJson(
      _rows('staff_applications.json')[0],
    ).withProgramName('Merit Scholarship 2026');

    await tester.pumpWidget(
      RepositoryProvider<ScholarshipRepository>.value(
        value: _StubRepository(<ScholarshipApplication>[app]),
        child: const MaterialApp(
          localizationsDelegates: <LocalizationsDelegate<dynamic>>[
            AppLocalizations.delegate,
            DefaultMaterialLocalizations.delegate,
            DefaultWidgetsLocalizations.delegate,
          ],
          home: ScholarshipStatusScreen(studentId: _studentA),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Merit Scholarship 2026'), findsOneWidget);
    // Badge + timeline step both say "Under Review"; never "Draft".
    expect(find.text('Under Review'), findsWidgets);
    expect(find.text('Draft'), findsNothing);
    await getIt.reset();
  });
}
