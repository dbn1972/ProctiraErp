import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/staff/data/staff_repository.dart';
import 'package:proctira_mobile/features/survey/data/survey_repository.dart';
import 'package:proctira_mobile/features/transport/data/transport_repository.dart';
import 'package:proctira_mobile/features/workflow/data/workflow_repository.dart';

Dio _dioWithMap(Map<String, dynamic> responses) {
  final Dio dio = Dio(BaseOptions(baseUrl: 'https://example.test'));
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
        final String key = options.path;
        if (!responses.containsKey(key)) {
          handler.reject(
            DioException(
              requestOptions: options,
              response: Response<dynamic>(
                requestOptions: options,
                statusCode: 404,
              ),
              type: DioExceptionType.badResponse,
            ),
          );
          return;
        }
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            statusCode: 200,
            data: responses[key],
          ),
        );
      },
    ),
  );
  return dio;
}

void main() {
  group('StaffRepository', () {
    test('listStaff unwraps data array', () async {
      final StaffRepository repo = StaffRepository(
        dio: _dioWithMap(<String, dynamic>{
          '/api/v1/staff': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 's1',
                'firstName': 'Minati',
                'lastName': 'Behera',
                'position': 'TGT',
                'status': 'ACTIVE',
              },
            ],
          },
        }),
      );
      final List<StaffMember> staff = await repo.listStaff();
      expect(staff, hasLength(1));
      expect(staff.first.fullName, 'Minati Behera');
    });

    test('getStaffDetail loads appraisals and certifications', () async {
      final StaffRepository repo = StaffRepository(
        dio: _dioWithMap(<String, dynamic>{
          '/api/v1/staff/s1': <String, dynamic>{
            'id': 's1',
            'firstName': 'Minati',
            'lastName': 'Behera',
            'position': 'TGT',
            'status': 'ACTIVE',
          },
          '/api/v1/staff/appraisals': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'a1',
                'appraisalDate': '2026-01-01',
                'totalScore': 88,
                'status': 'COMPLETED',
              },
            ],
          },
          '/api/v1/staff/training/certifications': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'c1',
                'certificationName': 'Child Protection',
                'issuedDate': '2025-06-01',
                'status': 'VALID',
              },
            ],
          },
        }),
      );
      final StaffDetailBundle? detail = await repo.getStaffDetail('s1');
      expect(detail, isNotNull);
      expect(detail!.appraisals, hasLength(1));
      expect(detail.certifications.first.certificationName, 'Child Protection');
    });
  });

  group('TransportRepository', () {
    test('getOverview aggregates routes vehicles assignments', () async {
      final TransportRepository repo = TransportRepository(
        dio: _dioWithMap(<String, dynamic>{
          '/api/v1/transport/routes': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'r1',
                'name': 'Route A',
                'status': 'active',
                'startLocation': 'Depot',
                'endLocation': 'School',
              },
            ],
          },
          '/api/v1/transport/vehicles': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'v1',
                'registrationNumber': 'OD-13-AB-1234',
                'capacity': 40,
                'status': 'active',
              },
            ],
          },
          '/api/v1/transport/student-assignments': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'as1',
                'studentId': 'stu-1',
                'routeId': 'r1',
                'startDate': '2026-04-01',
                'isActive': true,
              },
            ],
          },
        }),
      );
      final TransportOverview overview = await repo.getOverview();
      expect(overview.activeRouteCount, 1);
      expect(overview.activeVehicleCount, 1);
      expect(overview.activeAssignmentCount, 1);
    });
  });

  group('WorkflowRepository', () {
    test('listPendingApprovals falls back to active instances', () async {
      final WorkflowRepository repo = WorkflowRepository(
        dio: _dioWithMap(<String, dynamic>{
          // pending endpoint missing → 404 → fallback
          '/api/v1/workflows/instances': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'i1',
                'workflowDefinitionId': 'd1',
                'entityType': 'student_transfer',
                'entityId': 'stu-9',
                'currentStateId': 'district',
                'status': 'ACTIVE',
                'createdAt': '2026-09-01T00:00:00Z',
              },
            ],
          },
        }),
      );
      final List<WorkflowApproval> approvals =
          await repo.listPendingApprovals();
      expect(approvals, hasLength(1));
      expect(approvals.first.instanceId, 'i1');
      expect(approvals.first.stepName, 'district');
    });
  });

  group('SurveyRepository', () {
    test('listSurveys and getSurvey parse questions', () async {
      final SurveyRepository repo = SurveyRepository(
        dio: _dioWithMap(<String, dynamic>{
          '/api/v1/surveys': <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'sv1',
                'name': 'Mid-Day Meal',
                'status': 'published',
                'createdAt': '2026-01-01',
                'updatedAt': '2026-01-02',
              },
            ],
          },
          '/api/v1/surveys/sv1': <String, dynamic>{
            'id': 'sv1',
            'name': 'Mid-Day Meal',
            'status': 'published',
            'createdAt': '2026-01-01',
            'updatedAt': '2026-01-02',
            'questions': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'q1',
                'label': 'Meals served?',
                'type': 'number',
                'order': 1,
                'required': true,
              },
            ],
          },
        }),
      );
      final List<Survey> list = await repo.listSurveys();
      expect(list.first.name, 'Mid-Day Meal');
      final Survey? detail = await repo.getSurvey('sv1');
      expect(detail!.questions, hasLength(1));
      expect(detail.questions.first.label, 'Meals served?');
    });
  });
}
