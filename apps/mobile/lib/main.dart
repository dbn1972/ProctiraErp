import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app/app.dart';
import 'core/auth/auth_bloc.dart';
import 'core/di/injector.dart';
import 'core/notifications/fcm_service.dart';
import 'core/router/app_router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  await configureDependencies();

  // Kick off initial auth state restoration before the app renders.
  getIt<AuthBloc>().add(const AuthBootstrapRequested());

  runApp(const OpenEmisApp());

  // Push notifications boot after `runApp` so the UI is interactive even
  // when Firebase config is missing on the device.
  unawaited(_initialisePushNotifications());
}

Future<void> _initialisePushNotifications() async {
  final FcmService fcm = getIt<FcmService>();
  await fcm.start();
  fcm.deepLinks.listen((FcmDeepLink link) {
    final AppRouter router = getIt<AppRouter>();
    router.config.go(link.route);
  });
}
