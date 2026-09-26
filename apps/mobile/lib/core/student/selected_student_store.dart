import 'package:flutter/foundation.dart';

import '../storage/secure_storage.dart';

/// Device-local student the home tiles and feature routes should open.
///
/// Staff and guardians pick a student once; assessments, examinations,
/// health, and scholarships read this id when a route has no `studentId`.
class SelectedStudentStore extends ChangeNotifier {
  SelectedStudentStore(this._storage);

  final SecureStorage _storage;

  String? _studentId;
  String? _displayName;

  String? get studentId => _studentId;
  String? get displayName => _displayName;

  bool get hasStudent => _studentId != null && _studentId!.isNotEmpty;

  Future<void> bootstrap() async {
    _studentId = await _storage.readSelectedStudentId();
    _displayName = await _storage.readSelectedStudentName();
    if (_studentId != null && _studentId!.isEmpty) {
      _studentId = null;
    }
    notifyListeners();
  }

  /// Remember [id]. An empty [displayName] keeps the previous name only when
  /// the id did not change.
  Future<void> select({required String id, String? displayName}) async {
    final String trimmed = id.trim();
    if (trimmed.isEmpty) {
      return;
    }
    final bool same = _studentId == trimmed;
    String? nextName = _displayName;
    if (displayName != null && displayName.trim().isNotEmpty) {
      nextName = displayName.trim();
    } else if (!same) {
      nextName = null;
    }
    if (same && nextName == _displayName) {
      return;
    }
    _studentId = trimmed;
    _displayName = nextName;
    await _storage.writeSelectedStudent(id: trimmed, displayName: nextName);
    notifyListeners();
  }

  Future<void> clear() async {
    _studentId = null;
    _displayName = null;
    await _storage.clearSelectedStudent();
    notifyListeners();
  }
}
