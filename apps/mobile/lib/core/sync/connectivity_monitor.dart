import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

/// Thin abstraction over `connectivity_plus` so the sync engine can be unit
/// tested with a fake stream. The mobile app injects [RealConnectivityMonitor]
/// at runtime; tests provide [FakeConnectivityMonitor].
abstract class ConnectivityMonitor {
  /// Stream of online / offline transitions. Emits `true` when at least one
  /// transport becomes available.
  Stream<bool> get onlineStream;

  /// Snapshot read of the current state.
  Future<bool> isOnline();
}

class RealConnectivityMonitor implements ConnectivityMonitor {
  RealConnectivityMonitor([Connectivity? connectivity])
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  @override
  Stream<bool> get onlineStream {
    return _connectivity.onConnectivityChanged.map(_isOnline);
  }

  @override
  Future<bool> isOnline() async {
    final List<ConnectivityResult> results =
        await _connectivity.checkConnectivity();
    return _isOnline(results);
  }

  bool _isOnline(List<ConnectivityResult> results) {
    if (results.isEmpty) return false;
    for (final ConnectivityResult result in results) {
      if (result != ConnectivityResult.none) return true;
    }
    return false;
  }
}

/// Test double. Push values onto [controller] to drive the engine.
class FakeConnectivityMonitor implements ConnectivityMonitor {
  FakeConnectivityMonitor({bool startsOnline = false})
      : _online = startsOnline,
        controller = StreamController<bool>.broadcast();

  bool _online;
  final StreamController<bool> controller;

  @override
  Stream<bool> get onlineStream => controller.stream;

  @override
  Future<bool> isOnline() async => _online;

  void emit(bool online) {
    _online = online;
    controller.add(online);
  }

  Future<void> dispose() async {
    await controller.close();
  }
}
