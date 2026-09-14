import 'package:dio/dio.dart';

import '../models/attendance_record.dart';
import 'api_client.dart';

/// Typed wrapper around the attendance endpoints exposed by the backend.
///
/// The mobile sync engine calls [createStudentAttendance] /
/// [updateStudentAttendance] when draining its queue, forwarding the locally
/// stored version via `If-Match`.
class AttendanceApi extends BaseApi {
  AttendanceApi(super.dio);

  static const String _basePath = '/api/v1/attendance/students';

  /// Persist a brand-new attendance record. Returns the server-assigned
  /// canonical row (including `id` and `updatedAt`).
  Future<AttendanceRecord> createStudentAttendance(
    AttendanceRecord record, {
    String? idempotencyKey,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      _basePath,
      method: 'POST',
      data: record.toCreatePayload(),
      idempotencyKey: idempotencyKey,
    );
    return AttendanceRecord.fromJson(_unwrap(response.data));
  }

  /// Update an existing record. Sync engine sends [ifMatch] so the server can
  /// reject stale writes with `409 Conflict`.
  Future<AttendanceRecord> updateStudentAttendance(
    AttendanceRecord record, {
    required String ifMatch,
    String? idempotencyKey,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/${record.id}',
      method: 'PUT',
      data: record.toUpdatePayload(),
      ifMatch: ifMatch,
      idempotencyKey: idempotencyKey,
    );
    return AttendanceRecord.fromJson(_unwrap(response.data));
  }

  /// Delete a record. Returns `true` on success.
  Future<bool> deleteStudentAttendance(
    String id, {
    required String ifMatch,
    String? idempotencyKey,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$id',
      method: 'DELETE',
      ifMatch: ifMatch,
      idempotencyKey: idempotencyKey,
    );
    final int? status = response.statusCode;
    return status != null && status >= 200 && status < 300;
  }

  /// Fetch a single record (used by conflict reconciliation to refresh the
  /// local cache after the server rejects a stale write).
  Future<AttendanceRecord> fetchStudentAttendance(String id) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$id',
      method: 'GET',
    );
    return AttendanceRecord.fromJson(_unwrap(response.data));
  }

  Map<String, dynamic> _unwrap(Object? body) {
    if (body is Map<String, dynamic>) {
      // Backend responses follow `{ data: {...} }` shape; fall back to the
      // root if the envelope is missing.
      final Object? data = body['data'];
      if (data is Map<String, dynamic>) return data;
      return body;
    }
    throw FormatException('Unexpected response body: $body');
  }
}
