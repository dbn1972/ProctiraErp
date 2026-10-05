import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/unsynced_work.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/tenant/presentation/tenant_selection_screen.dart';

/// PRC-M034 follow-up (PR #542 review): a signed-in workspace switch never
/// silently deletes unsynced offline work, and the screen cannot hang.
void main() {
  late SecureStorage secure;
  late TenantProvider tenant;
  late AuthBloc auth;
  late Future<UnsyncedWork> Function() inspect;
  int inspections = 0;

  Future<void> pumpScreen(
    WidgetTester tester, {
    Duration switchTimeout = const Duration(seconds: 45),
  }) async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTokens(accessToken: 'a-old', refreshToken: 'r-old');
    tenant = TenantProvider(secure);
    await tenant.setTenant(tenantId: 'tenant-old', displayName: 'Old');
    inspections = 0;
    auth = AuthBloc(
      secureStorage: secure,
      tenantProvider: tenant,
      inspectUnsyncedWork: () {
        inspections += 1;
        return inspect();
      },
    );
    await getIt.reset();
    getIt
      ..registerSingleton<TenantProvider>(tenant)
      ..registerSingleton<AuthBloc>(auth);
    final Future<AuthState> ready = auth.stream.firstWhere(
      (AuthState s) => s.isAuthenticated,
    );
    auth.add(const AuthBootstrapRequested());
    await ready;

    final GoRouter router = GoRouter(
      initialLocation: '/tenant?switch=1',
      routes: <RouteBase>[
        GoRoute(
          path: '/tenant',
          builder: (_, _) =>
              TenantSelectionScreen(switchTimeout: switchTimeout),
        ),
        GoRoute(path: '/login', builder: (_, _) => const Text('login-screen')),
      ],
    );
    addTearDown(() async {
      await auth.close();
      await getIt.reset();
    });
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, 'tenant-new');
    await tester.pump();
  }

  testWidgets('queued mark: switch asks first, "stay" keeps everything', (
    WidgetTester tester,
  ) async {
    inspect = () async => const UnsyncedWork(queuedChanges: 1);
    await pumpScreen(tester);

    await tester.tap(find.text('Switch workspace'));
    await tester.pumpAndSettle();

    expect(find.text('Unsynced work on this device'), findsOneWidget);
    expect(find.textContaining('1 unsynced change.'), findsOneWidget);
    expect(auth.state.isAuthenticated, isTrue);

    await tester.tap(find.text('Stay and keep it'));
    await tester.pumpAndSettle();

    expect(find.text('Unsynced work on this device'), findsNothing);
    expect(find.text('login-screen'), findsNothing);
    expect(auth.state.isAuthenticated, isTrue);
    expect(await secure.readAccessToken(), 'a-old');
    expect(tenant.tenantId, 'tenant-old');
    expect(find.text('Switch workspace'), findsOneWidget);
  });

  testWidgets('"discard and switch" signs out and activates the new id', (
    WidgetTester tester,
  ) async {
    inspect = () async => const UnsyncedWork(queuedChanges: 1);
    await pumpScreen(tester);

    await tester.tap(find.text('Switch workspace'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('discard-and-switch')));
    await tester.pumpAndSettle();

    expect(find.text('login-screen'), findsOneWidget);
    expect(auth.state.status, AuthStatus.unauthenticated);
    expect(await secure.readAccessToken(), isNull);
    expect(tenant.tenantId, 'tenant-new');
    // The confirmed retry skips the check instead of asking again.
    expect(inspections, 1);
  });

  testWidgets('nothing unsynced: switch proceeds without a prompt', (
    WidgetTester tester,
  ) async {
    inspect = () async => const UnsyncedWork();
    await pumpScreen(tester);

    await tester.tap(find.text('Switch workspace'));
    await tester.pumpAndSettle();

    expect(find.text('Unsynced work on this device'), findsNothing);
    expect(find.text('login-screen'), findsOneWidget);
    expect(tenant.tenantId, 'tenant-new');
  });

  testWidgets('a stalled switch times out with a retryable error', (
    WidgetTester tester,
  ) async {
    final Completer<UnsyncedWork> stalled = Completer<UnsyncedWork>();
    inspect = () => stalled.future;
    await pumpScreen(tester, switchTimeout: const Duration(seconds: 5));

    await tester.tap(find.text('Switch workspace'));
    await tester.pump();
    expect(find.text('Switching workspace…'), findsOneWidget);

    await tester.pump(const Duration(seconds: 6));

    expect(find.textContaining('taking too long'), findsOneWidget);
    expect(find.text('Switch workspace'), findsOneWidget);
    expect(find.text('login-screen'), findsNothing);

    // Let the bloc finish so teardown can close it.
    stalled.complete(const UnsyncedWork(queuedChanges: 1));
    await tester.pump();
  });
}
