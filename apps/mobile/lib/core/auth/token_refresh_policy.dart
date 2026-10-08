import 'package:dio/dio.dart';

/// Decides whether a failed token-refresh attempt should force a logout.
///
/// PRC-H013: a transient transport failure (timeout, connection error, or a
/// 5xx from the refresh/replay call) must NOT destroy the session and the
/// offline queue. Only an authoritative rejection of the refresh token
/// (HTTP 400/401/403 returned by `/auth/refresh`) means the session is truly
/// invalid and the user must sign in again.
///
/// Any other error class is treated as transient so a teacher on a patchy
/// school network keeps their session (and their unsynced attendance) instead
/// of being silently signed out and purged.
bool shouldForceLogoutOnRefreshFailure(Object error) {
  if (error is! DioException) {
    // A non-Dio error (e.g. a malformed refresh payload StateError) is not an
    // auth rejection: the token may still be valid, so keep the session.
    return false;
  }

  switch (error.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
    case DioExceptionType.transformTimeout:
    case DioExceptionType.connectionError:
    case DioExceptionType.cancel:
    case DioExceptionType.unknown:
      return false;
    case DioExceptionType.badCertificate:
      return false;
    case DioExceptionType.badResponse:
      final int? status = error.response?.statusCode;
      if (status == null) {
        return false;
      }
      // Only an explicit rejection of the refresh token invalidates the
      // session. 5xx (and anything that is not 400/401/403) is transient.
      return status == 400 || status == 401 || status == 403;
  }
}
