/// Session hooks for push-device registration (PRC-M033).
///
/// [AuthBloc] calls [onAuthenticated] once a session exists (login or
/// restored session) and awaits [onLoggingOut] before tokens are cleared and
/// caches purged, so the backend stops pushing to a signed-out device.
abstract class PushDeviceLifecycle {
  /// Register this device for the signed-in user. Must not throw.
  Future<void> onAuthenticated();

  /// Unregister this device and drop the push token. Must not throw.
  Future<void> onLoggingOut();
}
