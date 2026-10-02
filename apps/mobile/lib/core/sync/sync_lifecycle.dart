import 'dart:async';

import 'package:flutter/widgets.dart';

/// Bridges app lifecycle + auth transitions to the offline sync queue
/// (PRC-H010).
///
/// The queue is drained when:
/// - the user becomes authenticated (login or restored session at launch),
/// - the app returns to the foreground ([AppLifecycleState.resumed]) while
///   the user is authenticated.
///
/// [onFlush] is resolved lazily so the sync engine (and its HTTP stack) is
/// never constructed before a session exists.
class SyncLifecycleFlusher with WidgetsBindingObserver {
  SyncLifecycleFlusher({
    required this.onFlush,
    required Stream<bool> authenticatedStream,
    bool initiallyAuthenticated = false,
  }) : _authenticated = initiallyAuthenticated,
       _authStream = authenticatedStream;

  /// Invoked to request a queue flush (typically `SyncEngine.start` +
  /// `SyncEngine.requestFlush`).
  final void Function() onFlush;
  final Stream<bool> _authStream;

  bool _authenticated;
  StreamSubscription<bool>? _authSubscription;
  WidgetsBinding? _binding;

  bool get isAuthenticated => _authenticated;

  /// Start observing. Safe to call once; subsequent calls are no-ops.
  void attach([WidgetsBinding? binding]) {
    if (_binding != null) return;
    _binding = binding ?? WidgetsBinding.instance;
    _binding!.addObserver(this);
    _authSubscription = _authStream.listen((bool authenticated) {
      final bool becameAuthenticated = authenticated && !_authenticated;
      _authenticated = authenticated;
      if (becameAuthenticated) onFlush();
    });
    if (_authenticated) onFlush();
  }

  Future<void> detach() async {
    _binding?.removeObserver(this);
    _binding = null;
    await _authSubscription?.cancel();
    _authSubscription = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _authenticated) onFlush();
  }
}
