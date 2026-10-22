import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:test/test.dart';

/// Fake transport: returns a canned status/body and records requests.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.status);

  final int status;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromBytes(
      utf8.encode(jsonEncode(<String, dynamic>{})),
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio _dio(_FakeAdapter adapter) =>
    Dio(BaseOptions(baseUrl: 'https://api.test'))..httpClientAdapter = adapter;

/// PRC-L014: covers the new server read-sync endpoint.
void main() {
  group('NotificationDeviceApi.markAsRead', () {
    test('POSTs to /api/v1/notifications/:id/read', () async {
      final _FakeAdapter adapter = _FakeAdapter(200);
      final NotificationDeviceApi api = NotificationDeviceApi(_dio(adapter));

      await api.markAsRead('notif-1');

      expect(adapter.requests, hasLength(1));
      expect(adapter.requests.single.method, 'POST');
      expect(
        adapter.requests.single.path,
        '/api/v1/notifications/notif-1/read',
      );
    });

    test('does not throw into the caller on a non-2xx response', () async {
      final NotificationDeviceApi api = NotificationDeviceApi(
        _dio(_FakeAdapter(500)),
      );

      // Mirrors how notifications_screen.dart calls this: fire-and-forget,
      // never let a server failure break the tap/navigation flow.
      await expectLater(api.markAsRead('notif-1'), completes);
    });
  });
}
