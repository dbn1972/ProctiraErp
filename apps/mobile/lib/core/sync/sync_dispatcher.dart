import 'package:proctira_api_client/proctira_api_client.dart';

import 'sync_models.dart';

/// Result of replaying a single op against the backend.
sealed class DispatchOutcome {
  const DispatchOutcome();
}

/// Operation succeeded; engine should drop the queued row and update the
/// local cache with [serverEntity] (already serialised to a JSON-friendly
/// map).
class DispatchSuccess extends DispatchOutcome {
  const DispatchSuccess({
    required this.serverEntity,
    required this.serverVersion,
    this.serverEntityId,
  });

  final Map<String, dynamic> serverEntity;
  final String serverVersion;

  /// Server-assigned id (only set on `create`).
  final String? serverEntityId;
}

/// Operation failed transiently; engine retries with backoff.
class DispatchTransient extends DispatchOutcome {
  const DispatchTransient(this.message);
  final String message;
}

/// Permanent failure; engine parks the row.
class DispatchPermanent extends DispatchOutcome {
  const DispatchPermanent(this.message);
  final String message;
}

/// Server rejected with 409 conflict; engine moves the row into
/// `sync_conflicts`.
class DispatchConflict extends DispatchOutcome {
  const DispatchConflict({this.serverVersion, this.serverPayload});
  final String? serverVersion;
  final Map<String, dynamic>? serverPayload;
}

/// Pluggable executor invoked by [SyncEngine] when draining the queue. Each
/// entity-type has its own implementation; tests can supply a fake to drive
/// the engine without an HTTP server.
abstract class SyncDispatcher {
  /// Replay [row] against the backend.
  Future<DispatchOutcome> dispatch(PendingSyncRow row);
}

/// Production dispatcher backed by [AttendanceApi]. Other entity types can
/// follow the same pattern; for now the engine wires through this single
/// implementation.
class AttendanceSyncDispatcher implements SyncDispatcher {
  AttendanceSyncDispatcher(this.api);

  final AttendanceApi api;

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    if (row.entityType != SyncEntityType.attendance) {
      return const DispatchPermanent('Unsupported entity for attendance dispatcher');
    }

    try {
      switch (row.operation) {
        case SyncOperation.create:
          final AttendanceRecord record = AttendanceRecord.fromJson(row.payload);
          final AttendanceRecord saved = await api.createStudentAttendance(
            record,
            idempotencyKey: row.idempotencyKey,
          );
          return DispatchSuccess(
            serverEntity: <String, dynamic>{
              'id': saved.id,
              'studentId': saved.studentId,
              'institutionId': saved.institutionId,
              'classId': saved.classId,
              'subjectId': saved.subjectId,
              'periodId': saved.periodId,
              'attendanceDate': saved.attendanceDate,
              'status': saved.status.toWire(),
              'comment': saved.comment,
              'recordedBy': saved.recordedBy,
              'createdAt': saved.createdAt,
              'updatedAt': saved.updatedAt,
            },
            serverVersion: saved.version,
            serverEntityId: saved.id,
          );

        case SyncOperation.update:
          final String? ifMatch = row.baseVersion;
          if (ifMatch == null) {
            return const DispatchPermanent('Update missing base version');
          }
          final AttendanceRecord record = AttendanceRecord.fromJson(row.payload);
          final AttendanceRecord saved =
              await api.updateStudentAttendance(
            record,
            ifMatch: ifMatch,
            idempotencyKey: row.idempotencyKey,
          );
          return DispatchSuccess(
            serverEntity: <String, dynamic>{
              'id': saved.id,
              'studentId': saved.studentId,
              'institutionId': saved.institutionId,
              'classId': saved.classId,
              'subjectId': saved.subjectId,
              'periodId': saved.periodId,
              'attendanceDate': saved.attendanceDate,
              'status': saved.status.toWire(),
              'comment': saved.comment,
              'recordedBy': saved.recordedBy,
              'createdAt': saved.createdAt,
              'updatedAt': saved.updatedAt,
            },
            serverVersion: saved.version,
          );

        case SyncOperation.delete:
          final String? ifMatch = row.baseVersion;
          final String? id = row.entityId;
          if (id == null) {
            return const DispatchPermanent('Delete missing entity id');
          }
          if (ifMatch == null) {
            return const DispatchPermanent('Delete missing base version');
          }
          await api.deleteStudentAttendance(
            id,
            ifMatch: ifMatch,
            idempotencyKey: row.idempotencyKey,
          );
          return DispatchSuccess(
            serverEntity: const <String, dynamic>{},
            serverVersion: '',
          );
      }
    } on ConflictException catch (error) {
      Map<String, dynamic>? body;
      final Object? raw = error.responseBody;
      if (raw is Map<String, dynamic>) {
        final Object? data = raw['data'];
        if (data is Map<String, dynamic>) body = data;
      }
      return DispatchConflict(
        serverVersion: error.serverVersion,
        serverPayload: body,
      );
    } on PermanentApiException catch (error) {
      return DispatchPermanent(error.message);
    } on TransientApiException catch (error) {
      return DispatchTransient(error.message);
    } catch (error) {
      return DispatchTransient(error.toString());
    }
  }
}
