import '../storage/database.dart';
import '../storage/secure_storage.dart';
import '../student/selected_student_store.dart';
import '../sync/unsynced_work.dart';
import 'tenant_provider.dart';

/// Outcome of [TenantSwitcher.switchTo].
class TenantSwitchResult {
  const TenantSwitchResult.activated({required this.purged})
    : blockedBy = null;

  const TenantSwitchResult.blocked(UnsyncedWork this.blockedBy)
    : purged = false;

  /// True when the previous tenant's session and caches were wiped.
  final bool purged;

  /// Set when the switch was refused because the purge would delete
  /// unsynced work; nothing was changed.
  final UnsyncedWork? blockedBy;

  bool get isBlocked => blockedBy != null;
}

/// PRC-M565: switching to a *different* tenant on a shared device must not
/// leave the previous tenant's session or cached child data behind.
///
/// Used when nobody is signed in; a signed-in switch goes through
/// `AuthBloc` (`AuthWorkspaceSwitchRequested`). When the target tenant
/// differs from the active one, tokens, the selected student and every
/// offline cache / queue table are wiped before the new tenant is activated.
/// Re-selecting the same tenant keeps local data.
///
/// The purge deletes the offline queue, so unless [switchTo] is called with
/// `discardUnsyncedWork` the switch is refused (nothing purged, tenant
/// unchanged) while unsynced work exists, exactly like the signed-in switch.
/// An unreadable queue counts as unsynced work (fail closed).
class TenantSwitcher {
  TenantSwitcher({
    required TenantProvider tenantProvider,
    required SecureStorage storage,
    required AppDatabase database,
    SelectedStudentStore? selectedStudent,
    Future<UnsyncedWork> Function()? inspectUnsyncedWork,
  }) : _tenantProvider = tenantProvider,
       _storage = storage,
       _database = database,
       _selectedStudent = selectedStudent,
       _inspectUnsyncedWork =
           inspectUnsyncedWork ??
           UnsyncedWorkInspector(database: database).inspect;

  final TenantProvider _tenantProvider;
  final SecureStorage _storage;
  final AppDatabase _database;
  final SelectedStudentStore? _selectedStudent;
  final Future<UnsyncedWork> Function() _inspectUnsyncedWork;

  /// Activates [tenantId] unless the purge would delete unsynced work and
  /// [discardUnsyncedWork] is false.
  Future<TenantSwitchResult> switchTo({
    required String tenantId,
    String? displayName,
    bool discardUnsyncedWork = false,
  }) async {
    final String? previous = _tenantProvider.tenantId;
    final bool crossTenant =
        previous != null && previous.isNotEmpty && previous != tenantId;
    if (crossTenant) {
      if (!discardUnsyncedWork) {
        final UnsyncedWork pending = await _inspect();
        if (!pending.isEmpty) {
          return TenantSwitchResult.blocked(pending);
        }
      }
      await _storage.clearTokens();
      await _selectedStudent?.clear();
      await _database.purgeAllUserData();
    }
    await _tenantProvider.setTenant(
      tenantId: tenantId,
      displayName: displayName,
    );
    return TenantSwitchResult.activated(purged: crossTenant);
  }

  Future<UnsyncedWork> _inspect() async {
    try {
      return await _inspectUnsyncedWork();
    } catch (_) {
      return const UnsyncedWork.unknown();
    }
  }
}
