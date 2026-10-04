// PRC-H011: parked / conflicted queue rows are surfaced with retry + review.
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/conflict_resolver.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/sync/sync_status_banner.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _PermanentDispatcher implements SyncDispatcher {
  DispatchOutcome next = const DispatchPermanent('422 validation');
  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async => next;
}

class _FakeController implements SyncStatusController {
  _FakeController(this.current);
  SyncQueueSummary current;
  final StreamController<void> _changes = StreamController<void>.broadcast();
  int retries = 0;
  final List<SyncConflict> pendingConflicts = <SyncConflict>[];
  final List<ConflictResolution?> choices = <ConflictResolution?>[];
  final ConflictResolver _resolver = ConflictResolver(
    database: AppDatabase(overridePath: 'unused.db'),
  );

  void emit(SyncQueueSummary next) {
    current = next;
    _changes.add(null);
  }

  @override
  Stream<void> get changes => _changes.stream;

  @override
  Future<SyncQueueSummary> summary() async => current;

  @override
  Future<int> retryParked() async {
    retries += 1;
    current = SyncQueueSummary(pending: current.parked);
    return 1;
  }

  @override
  Future<List<SyncConflict>> conflicts() async => pendingConflicts;

  @override
  Future<bool> reviewConflict(BuildContext context, SyncConflict c) async {
    final ConflictResolution? choice = await _resolver.showConflictDialog(
      context,
      c,
    );
    choices.add(choice);
    return choice != null;
  }
}

SyncConflict _conflict() => SyncConflict(
  id: 1,
  tenantId: 'tenant-a',
  entityType: SyncEntityType.attendance,
  entityId: 'att-1',
  operation: SyncOperation.update,
  localPayload: const <String, dynamic>{'status': 'ABSENT'},
  serverPayload: const <String, dynamic>{'status': 'EXCUSED'},
  baseVersion: 'v1',
  serverVersion: 'v2',
  detectedAt: 1,
);

Widget _host(Widget child) => MaterialApp(
  localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
    AppLocalizations.delegate,
    DefaultMaterialLocalizations.delegate,
    DefaultWidgetsLocalizations.delegate,
  ],
  home: Scaffold(body: child),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  group('SyncEngine queue surface', () {
    Future<({AppDatabase db, SyncEngine engine, _PermanentDispatcher d})>
    build() async {
      final Directory dir = await Directory.systemTemp.createTemp('sync_surf_');
      final AppDatabase db = AppDatabase(overridePath: '${dir.path}/o.db');
      final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
      await secure.writeTenant(tenantId: 'tenant-a', displayName: 'A');
      final TenantProvider tenant = TenantProvider(secure);
      await tenant.bootstrap();
      final _PermanentDispatcher d = _PermanentDispatcher();
      final SyncEngine engine = SyncEngine(
        database: db,
        tenantProvider: tenant,
        connectivity: FakeConnectivityMonitor(startsOnline: true),
        dispatchers: <SyncEntityType, SyncDispatcher>{
          SyncEntityType.attendance: d,
        },
        baseBackoff: Duration.zero,
      );
      return (db: db, engine: engine, d: d);
    }

    test(
      'permanent dispatch failure is counted as failed and retryable',
      () async {
        final ({AppDatabase db, SyncEngine engine, _PermanentDispatcher d})
        ctx = await build();
        await ctx.engine.enqueue(
          entityType: SyncEntityType.attendance,
          operation: SyncOperation.create,
          syncPayload: const <String, dynamic>{'status': 'PRESENT'},
          entityId: 'att-1',
        );
        final SyncFlushResult r = await ctx.engine.flushPending();
        expect(r.parked, 1);

        SyncQueueSummary s = await ctx.engine.queueSummary();
        expect(s.parked, 1);
        expect(s.pending, 0);
        expect(s.needsAttention, isTrue);
        expect(
          await ctx.engine.entityQueueStatuses(SyncEntityType.attendance),
          <String, SyncStatus>{'att-1': SyncStatus.parked},
        );

        expect(await ctx.engine.retryParked(), 1);
        final PendingSyncRow row = (await ctx.engine.getPending()).single;
        expect(row.status, SyncStatus.pending);
        expect(row.attempts, 0);

        ctx.d.next = const DispatchSuccess(
          serverEntity: <String, dynamic>{},
          serverVersion: 'v1',
          serverEntityId: 'att-1',
        );
        await ctx.engine.flushPending();
        s = await ctx.engine.queueSummary();
        expect(s.isEmpty, isTrue);
        await ctx.db.close();
      },
    );

    test('conflict keep-local re-queues the local payload', () async {
      final ({AppDatabase db, SyncEngine engine, _PermanentDispatcher d}) ctx =
          await build();
      ctx.d.next = const DispatchConflict(
        serverVersion: 'v2',
        serverPayload: <String, dynamic>{'status': 'EXCUSED'},
      );
      await ctx.engine.enqueue(
        entityType: SyncEntityType.attendance,
        operation: SyncOperation.update,
        syncPayload: const <String, dynamic>{'status': 'ABSENT'},
        entityId: 'att-1',
        baseVersion: 'v1',
      );
      await ctx.engine.flushPending();
      expect((await ctx.engine.queueSummary()).conflicted, 1);

      final ConflictResolver resolver = ConflictResolver(database: ctx.db);
      final SyncConflict conflict = (await ctx.engine.getConflicts()).single;
      await resolver.resolve(conflict, ConflictResolution.keepLocal);

      final PendingSyncRow row = (await ctx.engine.getPending()).single;
      expect(row.status, SyncStatus.pending);
      expect(row.baseVersion, 'v2');
      expect(row.payload['status'], 'ABSENT');
      expect(row.idempotencyKey, isNotEmpty);
      expect(await ctx.engine.getConflicts(), isEmpty);
      await ctx.db.close();
    });
  });

  group('SyncStatusBanner', () {
    testWidgets('renders nothing when the queue is empty', (
      WidgetTester t,
    ) async {
      await t.pumpWidget(
        _host(
          SyncStatusBanner(controller: _FakeController(SyncQueueSummary.empty)),
        ),
      );
      await t.pumpAndSettle();
      expect(find.byType(TextButton), findsNothing);
      expect(find.textContaining('change(s)'), findsNothing);
    });

    testWidgets('parked rows show a failed count and Retry', (
      WidgetTester t,
    ) async {
      final _FakeController c = _FakeController(
        const SyncQueueSummary(parked: 2),
      );
      await t.pumpWidget(_host(SyncStatusBanner(controller: c)));
      await t.pumpAndSettle();

      expect(find.text('2 change(s) not sent to the server'), findsOneWidget);
      expect(find.byIcon(Icons.sync_problem_outlined), findsOneWidget);
      await t.tap(find.widgetWithText(TextButton, 'Retry sync'));
      await t.pumpAndSettle();

      expect(c.retries, 1);
      expect(find.text('2 change(s) not sent to the server'), findsNothing);
      expect(find.text('2 change(s) waiting to sync'), findsOneWidget);
    });

    testWidgets('updates when the queue changes', (WidgetTester t) async {
      final _FakeController c = _FakeController(SyncQueueSummary.empty);
      await t.pumpWidget(_host(SyncStatusBanner(controller: c)));
      await t.pumpAndSettle();
      c.emit(const SyncQueueSummary(parked: 1));
      await t.pumpAndSettle();
      expect(find.text('1 change(s) not sent to the server'), findsOneWidget);
    });

    testWidgets('conflict row opens the resolution dialog', (
      WidgetTester t,
    ) async {
      final _FakeController c = _FakeController(
        const SyncQueueSummary(conflicted: 1),
      );
      c.pendingConflicts.add(_conflict());
      await t.pumpWidget(_host(SyncStatusBanner(controller: c)));
      await t.pumpAndSettle();

      expect(find.text('1 change(s) conflict with the server'), findsOneWidget);
      await t.tap(find.widgetWithText(TextButton, 'Review conflicts'));
      await t.pumpAndSettle();

      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.text('EXCUSED'), findsOneWidget);
      await t.tap(find.text('Keep local'));
      await t.pumpAndSettle();
      expect(c.choices, <ConflictResolution?>[ConflictResolution.keepLocal]);
    });

    testWidgets('banner action meets the 48dp touch target', (
      WidgetTester t,
    ) async {
      await t.pumpWidget(
        _host(
          SyncStatusBanner(
            controller: _FakeController(const SyncQueueSummary(parked: 1)),
          ),
        ),
      );
      await t.pumpAndSettle();
      await expectLater(t, meetsGuideline(androidTapTargetGuideline));
      await expectLater(t, meetsGuideline(textContrastGuideline));
    });
  });

  group('SyncRowStateLabel', () {
    Future<void> pumpLabel(WidgetTester t, SyncRowStateLabel label) =>
        t.pumpWidget(_host(label));

    testWidgets('failed row says so in text, not only colour', (
      WidgetTester t,
    ) async {
      await pumpLabel(
        t,
        const SyncRowStateLabel(
          recorded: true,
          synced: false,
          queueStatus: SyncStatus.parked,
        ),
      );
      expect(find.text('Not sent: sync failed'), findsOneWidget);
      expect(find.byIcon(Icons.sync_problem_outlined), findsOneWidget);
    });

    testWidgets('conflicted / synced / not marked labels', (
      WidgetTester t,
    ) async {
      await pumpLabel(
        t,
        const SyncRowStateLabel(
          recorded: true,
          synced: true,
          queueStatus: SyncStatus.conflicted,
        ),
      );
      expect(find.text('Conflict with server'), findsOneWidget);
      await pumpLabel(t, const SyncRowStateLabel(recorded: true, synced: true));
      expect(find.text('Synced'), findsOneWidget);
      await pumpLabel(
        t,
        const SyncRowStateLabel(recorded: false, synced: false),
      );
      expect(find.text('Not marked'), findsOneWidget);
    });
  });
}
