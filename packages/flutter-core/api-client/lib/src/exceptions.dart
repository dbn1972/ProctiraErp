/// Typed exceptions thrown by the OpenEMIS API client.
///
/// The mobile sync engine treats [ConflictException] specially: it triggers
/// the conflict-resolution flow rather than the standard retry-with-backoff
/// path used by [TransientApiException].
library;

import 'package:meta/meta.dart';

/// Base class for every error raised by the api-client package.
@immutable
sealed class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.responseBody});

  /// Human-readable message describing the failure.
  final String message;

  /// HTTP status code returned by the server, when available.
  final int? statusCode;

  /// Raw response payload from the server (decoded if possible).
  final Object? responseBody;

  @override
  String toString() {
    final String code = statusCode == null ? '' : ' [HTTP $statusCode]';
    return '$runtimeType$code: $message';
  }
}

/// Returned when the server rejects a request with `409 Conflict` because the
/// version supplied via `If-Match` does not match the current row.
final class ConflictException extends ApiException {
  const ConflictException(
    super.message, {
    super.statusCode = 409,
    super.responseBody,
    required this.serverVersion,
  });

  /// The server's authoritative version string. Callers should overwrite the
  /// local copy with the latest server value before re-applying the user's
  /// changes.
  final String? serverVersion;
}

/// Generic retriable failure (timeouts, 5xx, dropped connections).
final class TransientApiException extends ApiException {
  const TransientApiException(
    super.message, {
    super.statusCode,
    super.responseBody,
    this.cause,
  });

  /// Underlying error (typically a [DioException]).
  final Object? cause;
}

/// Permanent failure that should not be retried (e.g. validation 4xx).
final class PermanentApiException extends ApiException {
  const PermanentApiException(
    super.message, {
    super.statusCode,
    super.responseBody,
  });
}
