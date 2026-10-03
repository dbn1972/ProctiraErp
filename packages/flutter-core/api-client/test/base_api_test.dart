import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:test/test.dart';

/// Fake transport: returns a canned status/body and records requests.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.status, {this.body, this.headers = const {}});

  final int status;
  final Object? body;
  final Map<String, List<String>> headers;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final List<int> bytes = body is List<int>
        ? body! as List<int>
        : utf8.encode(jsonEncode(body ?? <String, dynamic>{}));
    return ResponseBody.fromBytes(
      bytes,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[
          body is List<int> ? 'application/octet-stream' : 'application/json',
        ],
        ...headers,
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio _dio(_FakeAdapter adapter) =>
    Dio(BaseOptions(baseUrl: 'https://api.test'))..httpClientAdapter = adapter;

Future<ApiException> _errorFor(_FakeAdapter adapter) async {
  final BaseApi api = BaseApi(_dio(adapter));
  try {
    await api.request<dynamic>('/x', method: 'GET');
  } on ApiException catch (e) {
    return e;
  }
  fail('expected ApiException');
}

void main() {
  group('BaseApi error translation', () {
    test('429 -> TransientApiException honouring Retry-After', () async {
      final ApiException e = await _errorFor(
        _FakeAdapter(
          429,
          body: <String, dynamic>{'message': 'slow down'},
          headers: <String, List<String>>{
            'retry-after': <String>['7'],
          },
        ),
      );
      expect(e, isA<TransientApiException>());
      expect(e.statusCode, 429);
      expect(
        (e as TransientApiException).retryAfter,
        const Duration(seconds: 7),
      );
    });

    for (final int status in <int>[408, 425]) {
      test('$status -> TransientApiException', () async {
        expect(
          await _errorFor(_FakeAdapter(status)),
          isA<TransientApiException>(),
        );
      });
    }

    test('400 -> PermanentApiException', () async {
      expect(await _errorFor(_FakeAdapter(400)), isA<PermanentApiException>());
    });

    test('409 -> ConflictException with server version', () async {
      final ApiException e = await _errorFor(
        _FakeAdapter(
          409,
          body: <String, dynamic>{
            'data': <String, dynamic>{'updatedAt': 'v2'},
          },
        ),
      );
      expect(e, isA<ConflictException>());
      expect((e as ConflictException).serverVersion, 'v2');
    });

    test('503 -> TransientApiException', () async {
      expect(await _errorFor(_FakeAdapter(503)), isA<TransientApiException>());
    });
  });

  group('Retry-After parsing', () {
    test('HTTP-date form', () {
      final Duration? d = BaseApi.parseRetryAfter(
        'Wed, 21 Oct 2015 07:28:30 GMT',
        now: DateTime.utc(2015, 10, 21, 7, 28),
      );
      expect(d, const Duration(seconds: 30));
    });
    test('garbage -> null', () {
      expect(BaseApi.parseRetryAfter('soon'), isNull);
    });
  });

  group('Idempotency-Key', () {
    test('generated for mutations when caller omits it', () async {
      final _FakeAdapter adapter = _FakeAdapter(200);
      await BaseApi(_dio(adapter)).request<dynamic>('/x', method: 'POST');
      final Object? key = adapter.requests.single.headers['Idempotency-Key'];
      expect(key, isA<String>());
      expect(
        key! as String,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
    });
    test('caller key preserved; GET carries none', () async {
      final _FakeAdapter adapter = _FakeAdapter(200);
      final BaseApi api = BaseApi(_dio(adapter));
      await api.request<dynamic>('/x', method: 'PATCH', idempotencyKey: 'k1');
      await api.request<dynamic>('/x', method: 'GET');
      expect(adapter.requests[0].headers['Idempotency-Key'], 'k1');
      expect(
        adapter.requests[1].headers.containsKey('Idempotency-Key'),
        isFalse,
      );
    });
  });

  group('ReportApi.downloadReport', () {
    test('500 throws TransientApiException (not raw DioException)', () async {
      final ReportApi api = ReportApi(_dio(_FakeAdapter(500)));
      await expectLater(
        api.downloadReport('r1'),
        throwsA(isA<TransientApiException>()),
      );
    });
    test('200 returns bytes', () async {
      final ReportApi api = ReportApi(
        _dio(_FakeAdapter(200, body: <int>[1, 2, 3])),
      );
      expect(
        await api.downloadReport('r1'),
        Uint8List.fromList(<int>[1, 2, 3]),
      );
    });
  });
}
