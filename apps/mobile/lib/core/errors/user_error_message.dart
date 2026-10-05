import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

/// Generic fallback shown when an error has no safe, specific message.
const String kGenericErrorMessage = 'Something went wrong. Please try again.';

/// Maps any thrown [error] to a short message that is safe to show users.
///
/// Raw `toString()` output (exception class names, URLs, stack fragments,
/// server internals) is never returned; details go to the debug log only
/// (PRC-L015). Server validation messages on 400/409/422 responses are
/// passed through because the API writes them for end users.
String userErrorMessage(
  Object error, {
  String fallback = kGenericErrorMessage,
  String? context,
}) {
  debugPrint('${context ?? 'error'}: $error');
  if (error is DioException) {
    return _fromDio(error, fallback);
  }
  if (error is ApiException) {
    // Typed api-client failures (PRC-M047): map by status, never echo
    // `toString()` (which carries the class name and raw server message).
    final int? status = error.statusCode;
    if (status == null) {
      if (error is TransientApiException && error.cause is DioException) {
        return _fromDio(error.cause! as DioException, fallback);
      }
      return error is TransientApiException ? _offline : fallback;
    }
    return _fromStatusCode(status, error.responseBody, fallback);
  }
  if (error is StateError || error is TypeError) {
    return fallback;
  }
  if (error is SocketException) {
    return _offline;
  }
  if (error is TimeoutException) {
    return _timeout;
  }
  if (error is FormatException) {
    return 'We received data we could not read. Please try again later.';
  }
  return fallback;
}

const String _offline =
    "Can't reach the server. Check your connection and try again.";
const String _timeout = 'The request timed out. Please try again.';

String _fromDio(DioException error, String fallback) {
  switch (error.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
      return _timeout;
    case DioExceptionType.connectionError:
      return _offline;
    case DioExceptionType.cancel:
      return 'The request was cancelled.';
    case DioExceptionType.badCertificate:
      return 'A secure connection could not be established.';
    case DioExceptionType.badResponse:
      return _fromStatus(error.response, fallback);
    case DioExceptionType.unknown:
      return error.error is SocketException ? _offline : fallback;
    default:
      return fallback;
  }
}

String _fromStatus(Response<dynamic>? response, String fallback) =>
    _fromStatusCode(response?.statusCode ?? 0, response?.data, fallback);

String _fromStatusCode(int status, Object? data, String fallback) {
  if (status == 401) {
    return 'Your session has expired. Please sign in again.';
  }
  if (status == 403) {
    return "You don't have permission to view this.";
  }
  if (status == 404) {
    return "We couldn't find what you were looking for.";
  }
  if (status == 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (status >= 500) {
    return 'The server had a problem. Please try again later.';
  }
  if (status == 400 || status == 409 || status == 422) {
    final String? message = _serverMessage(data);
    if (message != null) {
      return message;
    }
  }
  return fallback;
}

String? _serverMessage(Object? data) {
  if (data is! Map) {
    return null;
  }
  Object? message = data['message'];
  final Object? nested = data['error'];
  if (message == null && nested is Map) {
    message = nested['message'];
  }
  if (message is! String) {
    return null;
  }
  final String trimmed = message.trim();
  if (trimmed.isEmpty || trimmed.length > 200) {
    return null;
  }
  return trimmed;
}
