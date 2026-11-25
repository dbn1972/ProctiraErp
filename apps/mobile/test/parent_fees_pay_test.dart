// PRC-M039: the parent Fees screen can settle an open invoice through the
// sandbox pay route (sandbox/UAT builds only), and the repository posts to
// POST /api/v1/parent-portal/fees/invoices/:id/pay with method 'sandbox'.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/parent_portal/data/parent_portal_models.dart';
import 'package:proctira_mobile/features/parent_portal/data/parent_portal_repository.dart';
import 'package:proctira_mobile/features/parent_portal/presentation/parent_fees_screen.dart';

class _PayFake implements ParentPortalRepository {
  _PayFake({this.payError});

  final ParentPortalException? payError;
  final List<String> paid = <String>[];
  int invoiceLoads = 0;

  @override
  Future<List<LinkedChild>> listChildren() async => const <LinkedChild>[];

  @override
  Future<List<ParentMessageThread>> listThreads({
    required String studentId,
  }) async => const <ParentMessageThread>[];

  @override
  Future<List<ParentConsent>> listConsents({required String studentId}) async =>
      const <ParentConsent>[];

  @override
  Future<List<ParentInvoice>> listInvoices({required String studentId}) async {
    invoiceLoads += 1;
    return <ParentInvoice>[
      ParentInvoice(
        id: 'inv-open',
        studentId: studentId,
        title: 'Term fees',
        status: paid.contains('inv-open') ? 'paid' : 'open',
        amountCents: 250000,
        currency: 'INR',
      ),
      ParentInvoice(
        id: 'inv-paid',
        studentId: studentId,
        title: 'Bus fees',
        status: 'paid',
        amountCents: 1000,
        currency: 'INR',
      ),
    ];
  }

  @override
  Future<ParentInvoice> payInvoiceSandbox({required String invoiceId}) async {
    final ParentPortalException? error = payError;
    if (error != null) {
      throw error;
    }
    paid.add(invoiceId);
    return ParentInvoice(
      id: invoiceId,
      studentId: 'stu-1',
      title: 'Term fees',
      status: 'paid',
      amountCents: 250000,
      currency: 'INR',
    );
  }
}

Future<void> _pump(WidgetTester tester, Widget home) async {
  await tester.pumpWidget(MaterialApp(home: home));
  await tester.pump();
  await tester.pump();
}

class _Reply {
  const _Reply(this.body, {this.status = 200});
  final String body;
  final int status;
}

class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(this.reply);
  final _Reply reply;
  final List<RequestOptions> calls = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    return ResponseBody.fromString(
      reply.body,
      reply.status,
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
  testWidgets(
    'open invoice offers Pay (sandbox); tapping settles and reloads',
    (WidgetTester tester) async {
      final _PayFake repo = _PayFake();
      await _pump(
        tester,
        ParentFeesScreen(
          studentId: 'stu-1',
          repository: repo,
          sandboxPayEnabled: true,
        ),
      );
      // Only the open invoice has the action.
      expect(find.text(ParentFeesScreen.sandboxPayLabel), findsOneWidget);
      await tester.tap(find.text(ParentFeesScreen.sandboxPayLabel));
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(repo.paid, <String>['inv-open']);
      expect(repo.invoiceLoads, 2);
      expect(find.textContaining('No real money moved'), findsOneWidget);
      expect(find.text(ParentFeesScreen.sandboxPayLabel), findsNothing);
    },
  );

  testWidgets('a server refusal is shown and nothing is marked paid', (
    WidgetTester tester,
  ) async {
    final _PayFake repo = _PayFake(
      payError: const ParentPortalException(
        'Sandbox self-service payment is disabled',
        statusCode: 422,
      ),
    );
    await _pump(
      tester,
      ParentFeesScreen(
        studentId: 'stu-1',
        repository: repo,
        sandboxPayEnabled: true,
      ),
    );
    await tester.tap(find.text(ParentFeesScreen.sandboxPayLabel));
    await tester.pump();
    await tester.pump();
    await tester.pump();
    expect(
      find.text('Sandbox self-service payment is disabled'),
      findsOneWidget,
    );
    expect(repo.paid, isEmpty);
    expect(find.text(ParentFeesScreen.sandboxPayLabel), findsOneWidget);
  });

  testWidgets('builds without the sandbox flag stay read-only', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      ParentFeesScreen(studentId: 'stu-1', repository: _PayFake()),
    );
    expect(find.text('Term fees'), findsOneWidget);
    expect(find.text(ParentFeesScreen.sandboxPayLabel), findsNothing);
  });

  test('payInvoiceSandbox posts method sandbox and parses the invoice', () async {
    final _ScriptedAdapter adapter = _ScriptedAdapter(
      const _Reply(
        '{"invoice":{"id":"inv/1","studentId":"stu-1","title":"Term fees","status":"paid","amountCents":250000,"currency":"INR"},"payment":{},"receipt":{}}',
      ),
    );
    final ParentInvoice invoice = await _repo(
      adapter,
    ).payInvoiceSandbox(invoiceId: 'inv/1');
    expect(invoice.status, 'paid');
    expect(invoice.amountCents, 250000);
    final RequestOptions call = adapter.calls.single;
    expect(call.method, 'POST');
    expect(call.path, '/api/v1/parent-portal/fees/invoices/inv%2F1/pay');
    final Object? data = call.data;
    expect(data is String ? jsonDecode(data) : data, <String, dynamic>{
      'method': 'sandbox',
    });
  });

  test('payInvoiceSandbox surfaces the server message on 422', () async {
    final _ScriptedAdapter adapter = _ScriptedAdapter(
      const _Reply(
        '{"message":"Sandbox self-service payment is disabled"}',
        status: 422,
      ),
    );
    await expectLater(
      _repo(adapter).payInvoiceSandbox(invoiceId: 'inv-1'),
      throwsA(
        isA<ParentPortalException>()
            .having((ParentPortalException e) => e.statusCode, 'status', 422)
            .having(
              (ParentPortalException e) => e.message,
              'message',
              'Sandbox self-service payment is disabled',
            ),
      ),
    );
  });
}
