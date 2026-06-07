import 'package:dio/dio.dart';

import '../exceptions.dart';

/// Base helper used by every typed API. Wraps a [Dio] instance so we can
/// translate HTTP errors into the package's typed exception hierarchy and
/// honour the `If-Match` semantics expected by the sync engine.
class BaseApi {
  BaseApi(this.dio);

  /// Shared HTTP client. Callers (e.g. the mobile app) inject one configured
  /// with the `X-Tenant-ID` interceptor — this package never builds its own
  /// transport.
  final Dio dio;

  /// Send a request and translate failures into [ApiException]s.
  ///
  /// [ifMatch] is forwarded as the `If-Match` header. The backend returns
  /// `409 Conflict` when the client-supplied version is stale; that response
  /// becomes a [ConflictException] containing the server's current version.
  Future<Response<T>> request<T>(
    String path, {
    required String method,
    Map<String, dynamic>? queryParameters,
    Object? data,
    String? ifMatch,
    Options? options,
  }) async {
    final Options merged = (options ?? Options()).copyWith(
      method: method,
      headers: <String, dynamic>{
        ...?options?.headers,
        'If-Match': ?ifMatch,
      },
    );

    try {
      return await dio.request<T>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: merged,
      );
    } on DioException catch (error) {
      throw _translate(error);
    }
  }

  ApiException _translate(DioException error) {
    final Response<dynamic>? response = error.response;
    final int? status = response?.statusCode;
    final Object? body = response?.data;

    if (status == 409) {
      String? serverVersion;
      if (body is Map<String, dynamic>) {
        // The backend returns the current entity inside `data` so we can lift
        // its updatedAt as the new version.
        final Object? data = body['data'];
        if (data is Map<String, dynamic>) {
          final Object? raw = data['updatedAt'] ?? data['version'];
          if (raw is String) {
            serverVersion = raw;
          }
        }
      }
      return ConflictException(
        _messageFor(error, fallback: 'Conflict'),
        responseBody: body,
        serverVersion: serverVersion,
      );
    }

    if (status != null && status >= 400 && status < 500) {
      return PermanentApiException(
        _messageFor(error, fallback: 'Client error'),
        statusCode: status,
        responseBody: body,
      );
    }

    return TransientApiException(
      _messageFor(error, fallback: 'Transient error'),
      statusCode: status,
      responseBody: body,
      cause: error,
    );
  }

  String _messageFor(DioException error, {required String fallback}) {
    final Object? body = error.response?.data;
    if (body is Map<String, dynamic>) {
      final Object? message = body['message'] ?? body['error'];
      if (message is String && message.isNotEmpty) {
        return message;
      }
    }
    final String message = error.message ?? '';
    return message.isEmpty ? fallback : message;
  }
}
