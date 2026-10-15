import 'package:flutter/widgets.dart';

import 'auth_bloc.dart';

/// Re-locks an authenticated session when the app is resumed from the
/// background and biometric app-lock is enabled (PRC-M469).
///
/// Cold start is gated in [AuthBloc] bootstrap; this observer closes the
/// remaining gap where a backgrounded authenticated session returns to the
/// foreground still showing PII. On [AppLifecycleState.paused] the resume is
/// armed; on [AppLifecycleState.resumed] a re-lock is requested. The bloc
/// decides whether a lock is actually required (opted-in + available), so a
/// user without biometric lock is never interrupted.
class AppLockLifecycleObserver with WidgetsBindingObserver {
  AppLockLifecycleObserver(this._authBloc);

  final AuthBloc _authBloc;
  WidgetsBinding? _binding;
  bool _wentToBackground = false;

  /// Start observing. Safe to call once; subsequent calls are no-ops.
  void attach([WidgetsBinding? binding]) {
    if (_binding != null) return;
    _binding = binding ?? WidgetsBinding.instance;
    _binding!.addObserver(this);
  }

  void detach() {
    _binding?.removeObserver(this);
    _binding = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        _wentToBackground = true;
        break;
      case AppLifecycleState.resumed:
        if (_wentToBackground) {
          _wentToBackground = false;
          _authBloc.add(const AuthAppLockRequested());
        }
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
        break;
    }
  }
}
