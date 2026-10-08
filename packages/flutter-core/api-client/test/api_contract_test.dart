import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:test/test.dart';

/// PRC-M254: exercises every API class against a recording transport so
///  * each `fromJson` decoder is covered with a realistic envelope, and
///  * the set of (method, path) the client calls must equal
///    `contract/client_routes.json`, which the gateway test
///    `dart-client-contract.test.ts` checks against the mount matrix.
class _RecordingAdapter implements HttpClientAdapter {
  final Set<String> calls = <String>{};

  static final RegExp _idSegment = RegExp(r'/(?:id-[^/]+)(?=/|$)');

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final String path = options.uri.path.replaceAll(_idSegment, '/:id');
    final String route = '${options.method} $path';
    calls.add(route);
    if (path.endsWith('/download')) {
      return ResponseBody.fromBytes(<int>[9, 9], 200);
    }
    return ResponseBody.fromString(
      jsonEncode(_bodyFor(route)),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  Object _bodyFor(String route) {
    if (route.contains('/auth/login')) {
      return <String, dynamic>{
        'tokens': <String, dynamic>{
          'accessToken': 'a',
          'refreshToken': 'r',
          'expiresIn': 900,
        },
        'user': <String, dynamic>{'userId': 'u1'},
      };
    }
    if (route.contains('/auth/')) {
      return <String, dynamic>{'accessToken': 'a2', 'refreshToken': 'r2'};
    }
    if (route.contains('/attendance/')) {
      return <String, dynamic>{'data': _attendance};
    }
    if (route == 'GET /api/v1/students') {
      return <String, dynamic>{
        'data': <Object>[_student],
      };
    }
    if (route.contains('/students/')) {
      return <String, dynamic>{'data': _student};
    }
    if (route == 'GET /api/v1/institutions/:id') {
      return <String, dynamic>{'data': _institution};
    }
    if (route.endsWith('/contact')) {
      return <String, dynamic>{
        'data': <String, dynamic>{'phone': '+0'},
      };
    }
    if (route == 'GET /api/v1/reports') {
      return <String, dynamic>{
        'data': <Object>[_report],
      };
    }
    if (route.contains('/reports')) {
      return <String, dynamic>{'data': _report};
    }
    return <String, dynamic>{
      'data': <Object>[
        <String, dynamic>{'id': 'x'},
      ],
    };
  }

  @override
  void close({bool force = false}) {}
}

const Map<String, dynamic> _attendance = <String, dynamic>{
  'id': 'id-att',
  'studentId': 'id-stu',
  'institutionId': 'id-inst',
  'classId': 'id-class',
  'academicPeriodId': 'id-period',
  'date': '2025-01-02',
  'subjectId': null,
  'periodId': null,
  'status': 'PRESENT',
  'comment': null,
  'recordedBy': 'id-user',
  'createdAt': '2025-01-02T00:00:00Z',
  'updatedAt': '2025-01-02T00:00:00Z',
};
const Map<String, dynamic> _student = <String, dynamic>{
  'id': 'id-stu',
  'firstName': 'Ada',
  'lastName': 'L',
  'createdAt': '2025-01-01T00:00:00Z',
  'updatedAt': '2025-01-01T00:00:00Z',
};
const Map<String, dynamic> _institution = <String, dynamic>{
  'id': 'id-inst',
  'name': 'School',
  'code': 'S1',
  'createdAt': '2025-01-01T00:00:00Z',
  'updatedAt': '2025-01-01T00:00:00Z',
};
const Map<String, dynamic> _report = <String, dynamic>{
  'id': 'id-rep',
  'title': 'Roll',
  'status': 'completed',
  'format': 'pdf',
};

void main() {
  test(
    'every API class decodes responses and only calls contracted routes',
    () async {
      final _RecordingAdapter adapter = _RecordingAdapter();
      final Dio dio = Dio(BaseOptions(baseUrl: 'https://api.test'))
        ..httpClientAdapter = adapter;

      final AuthApi auth = AuthApi(dio);
      expect((await auth.login(username: 'u', password: 'p')).userId, 'u1');
      expect((await auth.refresh(refreshToken: 'r')).accessToken, 'a2');
      await auth.logout(refreshToken: 'r');

      final AttendanceApi attendance = AttendanceApi(dio);
      final AttendanceRecord record = AttendanceRecord.fromJson(_attendance);
      expect(record.status, AttendanceStatus.present);
      expect(record.date, '2025-01-02');
      expect(record.classId, 'id-class');
      expect(record.academicPeriodId, 'id-period');
      // Create and update both upsert through POST /attendance/student.
      expect((await attendance.recordStudentAttendance(record)).id, 'id-att');
      expect(
        (await attendance.recordStudentAttendance(
          record,
          idempotencyKey: 'idem-1',
        )).id,
        'id-att',
      );

      final StudentApi students = StudentApi(dio);
      expect((await students.listStudents()).single.firstName, 'Ada');
      expect((await students.fetchStudent('id-stu')).lastName, 'L');

      final InstitutionApi institutions = InstitutionApi(dio);
      expect((await institutions.fetchInstitution('id-inst')).code, 'S1');
      expect(await institutions.fetchAcademicPeriods('id-inst'), isNotEmpty);
      expect(await institutions.fetchInfrastructure('id-inst'), isNotEmpty);
      expect((await institutions.fetchContactInfo('id-inst'))['phone'], '+0');

      final NotificationDeviceApi devices = NotificationDeviceApi(dio);
      await devices.registerDevice(
        deviceToken: 't',
        platform: 'android',
        deviceId: 'id-dev',
      );
      await devices.unregisterDevice(deviceId: 'id-dev');
      expect(await devices.listNotifications(), isNotEmpty);

      final ReportApi reports = ReportApi(dio);
      expect((await reports.listReports()).single.title, 'Roll');
      expect((await reports.getReportStatus('id-rep')).status, 'completed');
      expect(await reports.downloadReport('id-rep'), <int>[9, 9]);
      expect(
        (await reports.requestReport(reportType: 'roll', format: 'pdf')).id,
        'id-rep',
      );

      final Map<String, dynamic> contract =
          jsonDecode(File('contract/client_routes.json').readAsStringSync())
              as Map<String, dynamic>;
      final List<String> expected =
          (contract['routes'] as List<dynamic>).cast<String>()..sort();
      final List<String> actual = adapter.calls.toList()..sort();
      expect(
        actual,
        expected,
        reason:
            'Client routes changed: update contract/client_routes.json so the '
            'gateway contract test can verify them.',
      );
    },
  );
}
