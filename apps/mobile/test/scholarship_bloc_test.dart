// PRC-M567: ScholarshipBloc over the real ScholarshipRepository (sqflite ffi +
// Dio fixture adapter). Fixtures: test/fixtures/scholarship.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/scholarship/bloc/scholarship_bloc.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const String _openProgram = '0b7f3a52-7c1e-4f0a-9d7e-111111111111';
const String _student = 'a0000000-0000-4000-8000-00000000000a';

String _fixture(String name) =>
    File('test/fixtures/scholarship/$name').readAsStringSync();

/// Routes by method + path. `offline` makes every call a connection error;
/// `failSubmit` returns 500 for application writes.
class _Adapter implements HttpClientAdapter {
  _Adapter({this.offline = false, this.failSubmit = false});

  final bool offline;
  final bool failSubmit;
  final List<RequestOptions> requests = <RequestOptions>[];

  ResponseBody _json(Object body, int status) => ResponseBody.fromString(
    body is String ? body : jsonEncode(body),
    status,
    headers: <String, List<String>>{
      Headers.contentTypeHeader: <String>[Headers.jsonContentType],
    },
  );

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (offline) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'offline',
      );
    }
    final String path = options.path;
    if (options.method == 'GET' && path.endsWith('/programs')) {
      return _json(_fixture('staff_programs.json'), 200);
    }
    if (options.method == 'POST' && path.contains('/applications')) {
      if (failSubmit) {
        return _json(<String, dynamic>{
          'code': 'INTERNAL',
          'message': 'boom',
          'statusCode': 500,
        }, 500);
      }
      return _json(<String, dynamic>{
        'data': <String, dynamic>{
          'id': 'app-1',
          'programId': _openProgram,
          'applicantId': _student,
          'status': 'submitted',
        },
      }, 201);
    }
    return _json(_fixture('staff_applications.json'), 200);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  Future<({ScholarshipBloc bloc, _Adapter adapter, AppDatabase db})> build(
    _Adapter adapter,
  ) async {
    final Directory dir = await Directory.systemTemp.createTemp('schol_bloc_');
    final AppDatabase db = AppDatabase(overridePath: '${dir.path}/o.db');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'A');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    final Dio dio = Dio(BaseOptions(baseUrl: 'https://api.test'))
      ..httpClientAdapter = adapter;
    final ScholarshipBloc bloc = ScholarshipBloc(
      repository: ScholarshipRepository(
        database: db,
        tenantProvider: tenant,
        dio: dio,
      ),
    );
    return (bloc: bloc, adapter: adapter, db: db);
  }

  Future<ScholarshipState> settle(ScholarshipBloc bloc) => bloc.stream
      .firstWhere(
        (ScholarshipState s) =>
            s.status == ScholarshipStatus.submitted ||
            s.status == ScholarshipStatus.error ||
            s.status == ScholarshipStatus.loaded,
      )
      .timeout(const Duration(seconds: 5));

  test('closed program is refused before any application write', () async {
    final ctx = await build(_Adapter());
    final Future<ScholarshipState> done = settle(ctx.bloc);
    // Second fixture program is status=closed.
    final String closedId =
        ((jsonDecode(_fixture('staff_programs.json'))
                        as Map<String, dynamic>)['data']
                    as List<dynamic>)
                .cast<Map<String, dynamic>>()
                .firstWhere(
                  (Map<String, dynamic> p) => p['status'] == 'closed',
                )['id']
            as String;
    ctx.bloc.add(
      ScholarshipApplicationSubmitted(programId: closedId, studentId: _student),
    );
    final ScholarshipState state = await done;
    expect(state.status, ScholarshipStatus.error);
    expect(state.errorMessage, contains('closed'));
    expect(
      ctx.adapter.requests.where((RequestOptions r) => r.method == 'POST'),
      isEmpty,
    );
    await ctx.bloc.close();
    await ctx.db.close();
  });

  test('draft is finalized via /applications/:id/submit', () async {
    final ctx = await build(_Adapter());
    final Future<ScholarshipState> done = settle(ctx.bloc);
    ctx.bloc.add(
      const ScholarshipApplicationSubmitted(
        programId: _openProgram,
        studentId: _student,
        draftApplicationId: 'draft-9',
      ),
    );
    final ScholarshipState state = await done;
    expect(state.status, ScholarshipStatus.submitted);
    final List<RequestOptions> posts = ctx.adapter.requests
        .where((RequestOptions r) => r.method == 'POST')
        .toList();
    expect(posts, hasLength(1));
    expect(
      posts.single.path,
      '/api/v1/scholarships/applications/draft-9/submit',
    );
    await ctx.bloc.close();
    await ctx.db.close();
  });

  test('new application posts the backend applicantId contract', () async {
    final ctx = await build(_Adapter());
    final Future<ScholarshipState> done = settle(ctx.bloc);
    ctx.bloc.add(
      const ScholarshipApplicationSubmitted(
        programId: _openProgram,
        studentId: _student,
      ),
    );
    expect((await done).status, ScholarshipStatus.submitted);
    final RequestOptions post = ctx.adapter.requests.firstWhere(
      (RequestOptions r) => r.method == 'POST',
    );
    final Map<String, dynamic> body = post.data as Map<String, dynamic>;
    expect(body['programId'], _openProgram);
    expect(body['applicantId'], _student);
    expect(body.containsKey('studentId'), isFalse);
    await ctx.bloc.close();
    await ctx.db.close();
  });

  test('server error maps to a user message, not a raw payload', () async {
    final ctx = await build(_Adapter(failSubmit: true));
    final Future<ScholarshipState> done = settle(ctx.bloc);
    ctx.bloc.add(
      const ScholarshipApplicationSubmitted(
        programId: _openProgram,
        studentId: _student,
      ),
    );
    final ScholarshipState state = await done;
    expect(state.status, ScholarshipStatus.error);
    expect(state.errorMessage, isNotNull);
    expect(state.errorMessage, isNot(contains('INTERNAL')));
    await ctx.bloc.close();
    await ctx.db.close();
  });

  test('offline programs request surfaces an error state', () async {
    final ctx = await build(_Adapter(offline: true));
    final Future<ScholarshipState> done = settle(ctx.bloc);
    ctx.bloc.add(const ScholarshipProgramsRequested());
    final ScholarshipState state = await done;
    expect(state.status, ScholarshipStatus.error);
    expect(state.errorMessage, isNotEmpty);
    await ctx.bloc.close();
    await ctx.db.close();
  });
}
