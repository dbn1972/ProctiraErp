import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Scripted response for [FakeHttpAdapter].
class FakeReply {
  const FakeReply(this.status, [this.body]) : type = null;

  /// Simulates a transport failure of [type] instead of an HTTP reply.
  const FakeReply.fail(this.type) : status = 0, body = null;

  final int status;
  final Object? body;
  final DioExceptionType? type;
}

/// In-process Dio adapter: `handler(options)` decides each reply.
class FakeHttpAdapter implements HttpClientAdapter {
  FakeHttpAdapter(this.handler);

  FakeReply Function(RequestOptions options) handler;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final FakeReply reply = handler(options);
    final DioExceptionType? type = reply.type;
    if (type != null) {
      throw DioException(requestOptions: options, type: type);
    }
    return ResponseBody.fromString(
      jsonEncode(reply.body ?? <String, dynamic>{}),
      reply.status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio fakeDio(FakeReply Function(RequestOptions options) handler) {
  final Dio dio = Dio(BaseOptions(baseUrl: 'http://localhost'));
  dio.httpClientAdapter = FakeHttpAdapter(handler);
  return dio;
}
