/// Public entry point for the hand-written ProctiraERP Dart API client.
///
/// Mirror of the typebox schemas exposed by the backend. The package is
/// intentionally small: it covers the endpoints needed by the mobile sync
/// engine (attendance + students + institutions) and provides a plumbing
/// layer for optimistic concurrency control via `If-Match` headers.
library;

export 'src/exceptions.dart';
export 'src/api/api_client.dart';
export 'src/api/attendance_api.dart';
export 'src/api/student_api.dart';
export 'src/api/institution_api.dart';
export 'src/api/notification_device_api.dart';
export 'src/api/report_api.dart';
export 'src/models/attendance_record.dart';
export 'src/models/student.dart';
export 'src/models/institution.dart';
export 'src/models/versioned.dart';
