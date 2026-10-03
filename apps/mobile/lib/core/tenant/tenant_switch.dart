import '../storage/database.dart';
import '../storage/secure_storage.dart';
import '../student/selected_student_store.dart';
import 'tenant_provider.dart';

/// PRC-M565: switching to a *different* tenant on a shared device must not
/// leave the previous tenant's session or cached child data behind.
///
/// When the target tenant differs from the active one, tokens, the selected
/// student and every offline cache / queue table are wiped before the new
/// tenant is activated. Re-selecting the same tenant keeps local data.
class TenantSwitcher {
  TenantSwitcher({
    required TenantProvider tenantProvider,
    required SecureStorage storage,
    required AppDatabase database,
    SelectedStudentStore? selectedStudent,
  }) : _tenantProvider = tenantProvider,
       _storage = storage,
       _database = database,
       _selectedStudent = selectedStudent;

  final TenantProvider _tenantProvider;
  final SecureStorage _storage;
  final AppDatabase _database;
  final SelectedStudentStore? _selectedStudent;

  /// Activates [tenantId]. Returns true when prior-tenant data was purged.
  Future<bool> switchTo({required String tenantId, String? displayName}) async {
    final String? previous = _tenantProvider.tenantId;
    final bool crossTenant =
        previous != null && previous.isNotEmpty && previous != tenantId;
    if (crossTenant) {
      await _storage.clearTokens();
      await _selectedStudent?.clear();
      await _database.purgeAllUserData();
    }
    await _tenantProvider.setTenant(
      tenantId: tenantId,
      displayName: displayName,
    );
    return crossTenant;
  }
}
