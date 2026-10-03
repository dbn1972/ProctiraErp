import 'dart:math';

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
    String? idempotencyKey,
    Options? options,
  }) async {
    final String upperMethod = method.toUpperCase();
    // Every mutation carries an Idempotency-Key so retries after a transient
    // failure (408/425/429/5xx) can never double-apply on the server.
    final String? effectiveKey =
        idempotencyKey ??
        (_safeMethods.contains(upperMethod) ? null : generateIdempotencyKey());
    final Options merged = (options ?? Options()).copyWith(
      method: method,
      headers: <String, dynamic>{
        ...?options?.headers,
        'If-Match': ?ifMatch,
        'Idempotency-Key': ?effectiveKey,
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

  static const Set<String> _safeMethods = <String>{'GET', 'HEAD', 'OPTIONS'};

  /// HTTP statuses that are retriable despite being in the 4xx range.
  static const Set<int> _transientClientStatuses = <int>{408, 425, 429};

  static final Random _random = Random.secure();

  /// RFC 4122 v4 UUID used as the default `Idempotency-Key` for mutations.
  static String generateIdempotencyKey() {
    final List<int> b = List<int>.generate(16, (_) => _random.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    final String hex = b
        .map((int v) => v.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  /// Parse a `Retry-After` header (delta-seconds or HTTP-date).
  static Duration? parseRetryAfter(String? raw, {DateTime? now}) {
    if (raw == null) return null;
    final String value = raw.trim();
    if (value.isEmpty) return null;
    final int? seconds = int.tryParse(value);
    if (seconds != null) {
      return seconds < 0 ? null : Duration(seconds: seconds);
    }
    try {
      final DateTime at = HttpDateParser.parse(value);
      final Duration diff = at.difference((now ?? DateTime.now()).toUtc());
      return diff.isNegative ? Duration.zero : diff;
    } on FormatException {
      return null;
    }
  }

  /// Translate a [DioException] into the typed hierarchy. Exposed for tests.
  ApiException translate(DioException error) => _translate(error);

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

    if (status != null && _transientClientStatuses.contains(status)) {
      return TransientApiException(
        _messageFor(error, fallback: 'Retriable client error'),
        statusCode: status,
        responseBody: body,
        cause: error,
        retryAfter: parseRetryAfter(response?.headers.value('retry-after')),
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
      retryAfter: parseRetryAfter(response?.headers.value('retry-after')),
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

/// Minimal RFC 7231 IMF-fixdate parser (e.g. `Wed, 21 Oct 2015 07:28:00 GMT`)
/// so the client does not depend on `dart:io` (web-safe).
abstract final class HttpDateParser {
  static const List<String> _months = <String>[
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  static DateTime parse(String value) {
    final RegExpMatch? m = RegExp(
      r'^[A-Za-z]{3}, (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$',
    ).firstMatch(value);
    if (m == null) throw FormatException('Invalid HTTP date: $value');
    final int month = _months.indexOf(m.group(2)!) + 1;
    if (month == 0) throw FormatException('Invalid HTTP month: $value');
    return DateTime.utc(
      int.parse(m.group(3)!),
      month,
      int.parse(m.group(1)!),
      int.parse(m.group(4)!),
      int.parse(m.group(5)!),
      int.parse(m.group(6)!),
    );
  }
}
