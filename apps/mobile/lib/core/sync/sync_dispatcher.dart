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
        case SyncOperation.update:
          // PRC-H060: the backend `POST /attendance/student` upserts on the
          // natural key, so both an offline create and a later edit replay
          // through the same call. There is no `If-Match`/PUT contract, which
          // also fixes PRC-H012 (edits of an unsynced create no longer need a
          // server version that does not exist yet).
          final AttendanceRecord record = AttendanceRecord.fromJson(
            row.payload,
          );
          final AttendanceRecord saved = await api.recordStudentAttendance(
            record,
            idempotencyKey: row.idempotencyKey,
          );
          return DispatchSuccess(
            serverEntity: _serverEntity(saved),
            serverVersion: saved.version,
            serverEntityId: saved.id,
          );

        case SyncOperation.delete:
          // The attendance backend exposes no delete endpoint; a queued
          // delete can never succeed, so park it instead of retrying forever.
          return const DispatchPermanent(
            'Attendance delete is not supported by the backend',
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
    } on ArgumentError catch (error) {
      // A payload missing a backend-required field (classId / academicPeriodId
      // / an unknown status) can never succeed — park it rather than retry.
      return DispatchPermanent('Invalid attendance payload: ${error.message}');
    } on FormatException catch (error) {
      return DispatchPermanent('Invalid attendance payload: ${error.message}');
    } on TypeError catch (error) {
      return DispatchPermanent('Invalid attendance payload: $error');
    } catch (error) {
      return DispatchTransient(error.toString());
    }
  }

  Map<String, dynamic> _serverEntity(AttendanceRecord saved) {
    return <String, dynamic>{
      'id': saved.id,
      'studentId': saved.studentId,
      'institutionId': saved.institutionId,
      'classId': saved.classId,
      'academicPeriodId': saved.academicPeriodId,
      'subjectId': saved.subjectId,
      'periodId': saved.periodId,
      'date': saved.date,
      'status': saved.status.toWire(),
      'comment': saved.comment,
      'recordedBy': saved.recordedBy,
      'createdAt': saved.createdAt,
      'updatedAt': saved.updatedAt,
    };
  }
}
