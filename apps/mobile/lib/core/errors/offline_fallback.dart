import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

/// True only when [error] means "the server could not be reached" (no
/// connection, DNS, timeout). Only these may fall back to cached data;
/// 401/403/404/4xx/5xx responses are real answers and must surface
/// (PRC-M043, PRC-M562).
bool isOfflineError(Object error) {
  if (error is DioException) {
    switch (error.type) {
      case DioExceptionType.connectionError:
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return true;
      case DioExceptionType.unknown:
        return error.response == null && error.error is SocketException;
      // badResponse, badCertificate, cancel, and any future types: the
      // server answered (or the user aborted), so never mask with cache.
      // ignore: no_default_cases
      default:
        return false;
    }
  }
  if (error is TransientApiException) {
    final Object? cause = error.cause;
    if (cause != null) return isOfflineError(cause);
    return error.statusCode == null;
  }
  return error is SocketException || error is TimeoutException;
}

/// Data plus a marker telling the UI it came from the offline cache.
class CachedResult<T> {
  const CachedResult(this.data, {this.fromCache = false, this.cachedAt});

  final T data;

  /// True when served from the local cache because the server was
  /// unreachable; the screen should show a "saved data" banner.
  final bool fromCache;

  /// When the cached copy was written, if known.
  final DateTime? cachedAt;
}
