import 'package:meta/meta.dart';

import 'versioned.dart';

/// Possible attendance statuses for a student.
///
/// Matches the backend Typebox literals in
/// `packages/backend/attendance/src/schemas.ts`
/// (`RecordStudentAttendanceSchema.status`).
enum AttendanceStatus {
  present,
  absent,
  late,
  excused,
  earlyDeparture;

  /// Server-side enum representation (matches the Typebox literals).
  String toWire() {
    switch (this) {
      case AttendanceStatus.present:
        return 'PRESENT';
      case AttendanceStatus.absent:
        return 'ABSENT';
      case AttendanceStatus.late:
        return 'LATE';
      case AttendanceStatus.excused:
        return 'EXCUSED';
      case AttendanceStatus.earlyDeparture:
        return 'EARLY_DEPARTURE';
    }
  }

  static AttendanceStatus fromWire(String value) {
    switch (value.toUpperCase()) {
      case 'PRESENT':
        return AttendanceStatus.present;
      case 'ABSENT':
        return AttendanceStatus.absent;
      case 'LATE':
        return AttendanceStatus.late;
      case 'EXCUSED':
        return AttendanceStatus.excused;
      case 'EARLY_DEPARTURE':
        return AttendanceStatus.earlyDeparture;
      default:
        throw ArgumentError.value(value, 'AttendanceStatus');
    }
  }
}

/// DTO that mirrors `StudentAttendanceResponseSchema` on the backend.
///
/// PRC-H060: field names (`date`, `academicPeriodId`) and the create payload
/// must match `RecordStudentAttendanceSchema`; the backend upserts on
/// `POST /attendance/student`, so there is no separate update/delete contract.
@immutable
class AttendanceRecord implements Versioned {
  const AttendanceRecord({
    required this.id,
    required this.studentId,
    required this.institutionId,
    required this.classId,
    required this.academicPeriodId,
    required this.date,
    required this.status,
    this.subjectId,
    this.periodId,
    this.comment,
    required this.recordedBy,
    required this.createdAt,
    required this.updatedAt,
  });

  @override
  final String id;
  final String studentId;
  final String institutionId;

  /// Class UUID — required by the backend record schema.
  final String classId;

  /// Academic period UUID — required by the backend record schema.
  final String academicPeriodId;
  final String? subjectId;
  final String? periodId;

  /// Attendance date (YYYY-MM-DD). Named `date` to match the backend contract.
  final String date;
  final AttendanceStatus status;
  final String? comment;
  final String recordedBy;
  final String createdAt;
  final String updatedAt;

  @override
  String get version => updatedAt;

  /// Body for `POST /attendance/student`. The backend upserts, so a locally
  /// edited (not-yet-synced or already-synced) record replays through the
  /// same payload — no `If-Match` and no separate update endpoint.
  Map<String, dynamic> toRecordPayload() {
    return <String, dynamic>{
      'studentId': studentId,
      'institutionId': institutionId,
      'classId': classId,
      'academicPeriodId': academicPeriodId,
      'date': date,
      if (subjectId != null) 'subjectId': subjectId,
      if (periodId != null) 'periodId': periodId,
      'status': status.toWire(),
      if (comment != null) 'comment': comment,
    };
  }

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    return AttendanceRecord(
      id: json['id'] as String,
      studentId: json['studentId'] as String,
      institutionId: json['institutionId'] as String,
      classId: json['classId'] as String,
      academicPeriodId: json['academicPeriodId'] as String,
      subjectId: json['subjectId'] as String?,
      periodId: json['periodId'] as String?,
      date: json['date'] as String,
      status: AttendanceStatus.fromWire(json['status'] as String),
      comment: json['comment'] as String?,
      recordedBy: json['recordedBy'] as String,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }
}
