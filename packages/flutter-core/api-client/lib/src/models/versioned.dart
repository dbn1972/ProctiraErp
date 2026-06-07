/// Marker interface for entities that participate in optimistic concurrency
/// control. The sync engine reads [version] when deciding what to send in
/// `If-Match` and uses it to detect 409 conflicts.
abstract class Versioned {
  /// Server-generated version token. The backend currently uses the
  /// `updatedAt` ISO-8601 timestamp as the version value.
  String get version;

  /// Stable identifier of the entity.
  String get id;
}
