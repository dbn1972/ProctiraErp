import 'package:dio/dio.dart';

import 'api_client.dart';

/// Typed wrapper around `/api/v1/notifications/devices` — the endpoint the
/// mobile app calls to register its FCM token with the backend.
///
/// The backend service is implemented elsewhere; this client is intentionally
/// minimal (token registration + unregistration). It also exposes a stub
/// `listNotifications` helper used by the in-app inbox to seed its cache.
class NotificationDeviceApi extends BaseApi {
  NotificationDeviceApi(super.dio);

  static const String _devicesPath = '/api/v1/notifications/devices';
  static const String _notificationsPath = '/api/v1/notifications';

  /// Register a device with the backend so it can receive push notifications.
  Future<void> registerDevice({
    required String deviceToken,
    required String platform,
    required String deviceId,
  }) async {
    await request<dynamic>(
      _devicesPath,
      method: 'POST',
      data: <String, dynamic>{
        'deviceToken': deviceToken,
        'platform': platform,
        'deviceId': deviceId,
      },
    );
  }

  /// Remove a previously registered device.
  Future<void> unregisterDevice({required String deviceId}) async {
    await request<dynamic>(
      '$_devicesPath/$deviceId',
      method: 'DELETE',
    );
  }

  /// Fetch the most recent notifications for the current user. Returns an
  /// empty list if the response is not in the expected envelope shape.
  Future<List<Map<String, dynamic>>> listNotifications({
    int page = 1,
    int pageSize = 50,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      _notificationsPath,
      method: 'GET',
      queryParameters: <String, dynamic>{
        'page': page,
        'pageSize': pageSize,
      },
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic> && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map<String, dynamic>>()
          .toList(growable: false);
    }
    return const <Map<String, dynamic>>[];
  }
}
