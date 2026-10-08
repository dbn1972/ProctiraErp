import 'package:dio/dio.dart';

import '../models/attendance_record.dart';
import 'api_client.dart';

/// Typed wrapper around the attendance endpoints exposed by the backend.
///
/// PRC-H060: the backend (`packages/backend/attendance/src/routes.ts`) exposes
/// `POST /attendance/student` (an upsert keyed by student+class+date+subject+
/// period) and `POST /attendance/student/bulk`; it has no PUT/DELETE/GET-by-id
/// routes. The mobile sync engine therefore replays both offline creates and
/// edits through [recordStudentAttendance].
class AttendanceApi extends BaseApi {
  AttendanceApi(super.dio);

  static const String _basePath = '/api/v1/attendance/student';

  /// Record (create or update) a student attendance mark. The backend updates
  /// the existing row when one already exists for the same natural key, so a
  /// locally edited mark replays through the same call without `If-Match`.
  ///
  /// Returns the server-assigned canonical row (including `id` and
  /// `updatedAt`).
  Future<AttendanceRecord> recordStudentAttendance(
    AttendanceRecord record, {
    String? idempotencyKey,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      _basePath,
      method: 'POST',
      data: record.toRecordPayload(),
      idempotencyKey: idempotencyKey,
    );
    return AttendanceRecord.fromJson(_unwrap(response.data));
  }

  Map<String, dynamic> _unwrap(Object? body) {
    if (body is Map<String, dynamic>) {
      // Some endpoints wrap the entity as `{ data: {...} }`; the record
      // endpoint returns the entity at the root. Support both.
      final Object? data = body['data'];
      if (data is Map<String, dynamic>) return data;
      return body;
    }
    throw FormatException('Unexpected response body: $body');
  }
}
