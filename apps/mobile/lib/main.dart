import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app/app.dart';
import 'core/auth/auth_bloc.dart';
import 'core/di/injector.dart';
import 'core/notifications/fcm_service.dart';
import 'core/router/app_router.dart';
import 'core/sync/sync_engine.dart';
import 'core/sync/sync_lifecycle.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Inter ships in assets/fonts (pubspec); never fetch fonts from Google at
  // runtime, so offline/low-bandwidth devices render the same type and no
  // request leaks to a third party (PRC-M471).
  GoogleFonts.config.allowRuntimeFetching = false;
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  await configureDependencies();

  // Kick off initial auth state restoration before the app renders.
  final AuthBloc authBloc = getIt<AuthBloc>();
  // Drain the offline queue on login / restored session and on app resume
  // (PRC-H010). The engine is resolved lazily so it never runs pre-auth.
  SyncLifecycleFlusher(
    onFlush: () {
      final SyncEngine engine = getIt<SyncEngine>();
      if (!engine.isRunning) engine.start();
      engine.requestFlush();
    },
    authenticatedStream: authBloc.stream.map(
      (AuthState state) => state.isAuthenticated,
    ),
    initiallyAuthenticated: authBloc.state.isAuthenticated,
  ).attach();
  authBloc.add(const AuthBootstrapRequested());

  runApp(const OpenEmisApp());

  // Push notifications boot after `runApp` so the UI is interactive even
  // when Firebase config is missing on the device.
  unawaited(_initialisePushNotifications());
}

Future<void> _initialisePushNotifications() async {
  final FcmService fcm = getIt<FcmService>();
  await fcm.start();
  bindPushDeepLinks(fcm.deepLinks, (String route) {
    getIt<AppRouter>().config.go(route);
  });
}
