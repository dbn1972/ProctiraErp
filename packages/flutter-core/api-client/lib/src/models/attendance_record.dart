import 'package:meta/meta.dart';

import 'versioned.dart';

/// Possible attendance statuses for a student.
enum AttendanceStatus {
  present,
  absent,
  late,
  excused;

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
      default:
        throw ArgumentError.value(value, 'AttendanceStatus');
    }
  }
}

/// DTO that mirrors `StudentAttendanceResponseSchema` on the backend.
@immutable
class AttendanceRecord implements Versioned {
  const AttendanceRecord({
    required this.id,
    required this.studentId,
    required this.institutionId,
    required this.attendanceDate,
    required this.status,
    this.classId,
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
  final String? classId;
  final String? subjectId;
  final String? periodId;
  final String attendanceDate; // YYYY-MM-DD
  final AttendanceStatus status;
  final String? comment;
  final String recordedBy;
  final String createdAt;
  final String updatedAt;

  @override
  String get version => updatedAt;

  Map<String, dynamic> toCreatePayload() {
    return <String, dynamic>{
      'studentId': studentId,
      'institutionId': institutionId,
      if (classId != null) 'classId': classId,
      if (subjectId != null) 'subjectId': subjectId,
      if (periodId != null) 'periodId': periodId,
      'attendanceDate': attendanceDate,
      'status': status.toWire(),
      if (comment != null) 'comment': comment,
    };
  }

  Map<String, dynamic> toUpdatePayload() {
    return <String, dynamic>{
      'status': status.toWire(),
      if (comment != null) 'comment': comment,
    };
  }

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    return AttendanceRecord(
      id: json['id'] as String,
      studentId: json['studentId'] as String,
      institutionId: json['institutionId'] as String,
      classId: json['classId'] as String?,
      subjectId: json['subjectId'] as String?,
      periodId: json['periodId'] as String?,
      attendanceDate: json['attendanceDate'] as String,
      status: AttendanceStatus.fromWire(json['status'] as String),
      comment: json['comment'] as String?,
      recordedBy: json['recordedBy'] as String,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }
}
