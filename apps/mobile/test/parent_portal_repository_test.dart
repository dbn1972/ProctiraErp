import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/parent_portal/data/parent_portal_models.dart';
import 'package:proctira_mobile/features/parent_portal/data/parent_portal_repository.dart';

class _Reply {
  const _Reply(this.body, {this.status = 200});

  final String body;
  final int status;
}

class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(this.routes);

  final Map<String, _Reply> routes;
  final List<RequestOptions> calls = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    final _Reply? reply = routes[options.path];
    final int status = reply?.status ?? 404;
    final String body = reply?.body ?? '{"message":"not found"}';
    return ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

DioParentPortalRepository _repo(_ScriptedAdapter adapter) {
  final Dio dio = Dio(BaseOptions(baseUrl: 'http://localhost'));
  dio.httpClientAdapter = adapter;
  return DioParentPortalRepository(dio: dio);
}

void main() {
  test(
    'listChildren reads the session route and does not send a tenant id',
    () async {
      final _ScriptedAdapter adapter = _ScriptedAdapter(<String, _Reply>{
        '/api/v1/parent-portal/children': const _Reply(
          '{"data":[{"id":"link-1","studentId":"stu-1","relationship":"mother","status":"active","studentName":"Amina Hassan","className":"Grade 4"}]}',
        ),
      });

      final List<LinkedChild> children = await _repo(adapter).listChildren();

      expect(children, hasLength(1));
      expect(children.single.nameLabel, 'Amina Hassan');
      expect(children.single.classLabel, 'Grade 4');
      expect(children.single.studentId, 'stu-1');
      expect(adapter.calls, hasLength(1));
      final RequestOptions request = adapter.calls.single;
      expect(request.path, '/api/v1/parent-portal/children');
      expect(request.method, 'GET');
      expect(request.data, isNull);
      expect(request.queryParameters.containsKey('tenantId'), isFalse);
      expect(request.headers['X-Tenant-ID'], isNull);
      expect(request.headers['Authorization'], isNull);
    },
  );

  test('listChildren fills name and class from student and timetable', () async {
    final _ScriptedAdapter adapter = _ScriptedAdapter(<String, _Reply>{
      '/api/v1/parent-portal/children': const _Reply(
        '{"data":[{"id":"link-1","studentId":"stu-1","relationship":"father","status":"active"}]}',
      ),
      '/api/v1/students/stu-1': const _Reply(
        '{"data":{"id":"stu-1","firstName":"Bilal","lastName":"Khan"}}',
      ),
      '/api/v1/parent-portal/children/stu-1/timetable': const _Reply(
        '{"data":[{"id":"slot-1","sectionId":"sec-1","sectionName":"Class 6B","dayOfWeek":1}]}',
      ),
    });

    final List<LinkedChild> children = await _repo(adapter).listChildren();

    expect(children.single.nameLabel, 'Bilal Khan');
    expect(children.single.classLabel, 'Class 6B');
    expect(
      adapter.calls.map((RequestOptions call) => call.path),
      containsAll(<String>[
        '/api/v1/students/stu-1',
        '/api/v1/parent-portal/children/stu-1/timetable',
      ]),
    );
  });

  test('listChildren stays honest when name and class lookups fail', () async {
    final _ScriptedAdapter adapter = _ScriptedAdapter(<String, _Reply>{
      '/api/v1/parent-portal/children': const _Reply(
        '{"data":[{"id":"link-1","studentId":"stu-9","relationship":"guardian","status":"active"}]}',
      ),
    });

    final List<LinkedChild> children = await _repo(adapter).listChildren();

    expect(children.single.nameLabel, 'Name unavailable');
    expect(children.single.classLabel, 'Class unavailable');
  });

  test('listChildren surfaces server errors', () async {
    final _ScriptedAdapter adapter = _ScriptedAdapter(<String, _Reply>{
      '/api/v1/parent-portal/children': const _Reply(
        '{"message":"Parent portal failed"}',
        status: 500,
      ),
    });

    expect(
      () => _repo(adapter).listChildren(),
      throwsA(
        isA<ParentPortalException>().having(
          (ParentPortalException error) => error.message,
          'message',
          'Parent portal failed',
        ),
      ),
    );
  });

  test('threads, consents, and invoices stay scoped to the selected child', () async {
    final _ScriptedAdapter adapter = _ScriptedAdapter(<String, _Reply>{
      '/api/v1/parent-portal/messages/threads': const _Reply(
        '{"data":['
        '{"id":"t-1","studentId":"stu-1","subject":"Trip","status":"open"},'
        '{"id":"t-2","studentId":"stu-2","subject":"Other child","status":"open"}'
        ']}',
      ),
      '/api/v1/parent-portal/consents': const _Reply(
        '{"data":['
        '{"id":"c-1","studentId":"stu-1","title":"Photo day","status":"pending","consentType":"photo"},'
        '{"id":"c-2","studentId":"stu-2","title":"Hidden","status":"pending","consentType":"trip"}'
        ']}',
      ),
      '/api/v1/parent-portal/fees/invoices': const _Reply(
        '{"data":['
        '{"id":"i-1","studentId":"stu-1","title":"Term fees","status":"issued","amountCents":150050,"currency":"KES"},'
        '{"id":"i-2","studentId":"stu-2","title":"Other","status":"issued","amountCents":10,"currency":"KES"}'
        ']}',
      ),
    });
    final DioParentPortalRepository repo = _repo(adapter);

    final List<ParentMessageThread> threads = await repo.listThreads(
      studentId: 'stu-1',
    );
    final List<ParentConsent> consents = await repo.listConsents(
      studentId: 'stu-1',
    );
    final List<ParentInvoice> invoices = await repo.listInvoices(
      studentId: 'stu-1',
    );

    expect(threads.map((ParentMessageThread row) => row.subject), <String>[
      'Trip',
    ]);
    expect(consents.map((ParentConsent row) => row.title), <String>[
      'Photo day',
    ]);
    expect(invoices.single.amountLabel, 'Ksh1,500.50');
    for (final RequestOptions call in adapter.calls) {
      expect(call.queryParameters.containsKey('tenantId'), isFalse);
      expect(call.queryParameters['scope'], isNot('staff'));
      expect(call.data, isNull);
    }
  });

  test('empty data is an empty child list', () async {
    final _ScriptedAdapter adapter = _ScriptedAdapter(<String, _Reply>{
      '/api/v1/parent-portal/children': const _Reply('{"data":[]}'),
    });

    expect(await _repo(adapter).listChildren(), isEmpty);
    expect(adapter.calls, hasLength(1));
  });
  test(
    'invoice with missing or non-numeric amount is flagged, not zeroed (PRC-L012)',
    () async {
      final _ScriptedAdapter adapter = _ScriptedAdapter(<String, _Reply>{
        '/api/v1/parent-portal/fees/invoices': const _Reply(
          '{"data":['
          '{"id":"i-1","studentId":"stu-1","title":"No amount","status":"issued","currency":"INR"},'
          '{"id":"i-2","studentId":"stu-1","title":"Bad amount","status":"issued","amountCents":"abc","currency":"INR"}'
          ']}',
        ),
      });
      final List<ParentInvoice> invoices = await _repo(
        adapter,
      ).listInvoices(studentId: 'stu-1');
      expect(invoices, hasLength(2));
      for (final ParentInvoice invoice in invoices) {
        expect(invoice.amountCents, isNull);
        expect(invoice.amountLabel, 'Amount unavailable');
      }
    },
  );
}
