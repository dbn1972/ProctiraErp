import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import '../../features/assessment/presentation/assessment_hub_screen.dart';
import '../../features/assessment/presentation/assessment_results_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/attendance/presentation/attendance_reports_screen.dart';
import '../../features/attendance/presentation/attendance_screen.dart';
import '../../features/examination/presentation/examination_detail_screen.dart';
import '../../features/examination/presentation/examination_list_screen.dart';
import '../../features/examination/presentation/examination_results_screen.dart';
import '../../features/health/presentation/health_records_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/home/presentation/services_screen.dart';
import '../../features/institutions/presentation/institution_detail_screen.dart';
import '../../features/institutions/presentation/institutions_screen.dart';
import '../../features/notifications/presentation/notification_preferences_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/reports/presentation/report_detail_screen.dart';
import '../../features/reports/presentation/reports_screen.dart';
import '../../features/scholarship/presentation/scholarship_application_screen.dart';
import '../../features/scholarship/presentation/scholarship_programs_screen.dart';
import '../../features/scholarship/presentation/scholarship_status_screen.dart';
import '../../features/staff/presentation/staff_detail_screen.dart';
import '../../features/staff/presentation/staff_list_screen.dart';
import '../../features/students/presentation/document_capture_screen.dart';
import '../../features/students/presentation/enrollment_history_screen.dart';
import '../../features/students/presentation/student_profile_screen.dart';
import '../../features/students/presentation/students_screen.dart';
import '../../features/survey/presentation/survey_screens.dart';
import '../../features/tenant/presentation/tenant_selection_screen.dart';
import '../../features/transport/presentation/transport_overview_screen.dart';
import '../../features/transport/presentation/transport_screens.dart';
import '../../features/workflow/presentation/workflow_screens.dart';
import '../auth/auth_bloc.dart';
import '../di/injector.dart';
import '../tenant/tenant_provider.dart';

/// GoRouter configuration with auth + tenant guards.
///
/// Redirect rules:
/// - If no tenant is configured, send the user to `/tenant`.
/// - If unauthenticated, send the user to `/login`.
/// - Authenticated users hitting `/login` or `/tenant` are bounced to `/`.
class AppRouter {
  AppRouter(this._authBloc) {
    _config = GoRouter(
      initialLocation: '/',
      refreshListenable: _AuthListenable(_authBloc),
      redirect: _redirect,
      routes: <RouteBase>[
        GoRoute(
          path: '/',
          name: 'home',
          builder: (BuildContext context, GoRouterState state) =>
              const HomeScreen(),
        ),
        GoRoute(
          path: '/services',
          name: 'services',
          builder: (BuildContext context, GoRouterState state) =>
              const ServicesScreen(),
        ),
        GoRoute(
          path: '/login',
          name: 'login',
          builder: (BuildContext context, GoRouterState state) =>
              const LoginScreen(),
        ),
        GoRoute(
          path: '/tenant',
          name: 'tenant',
          builder: (BuildContext context, GoRouterState state) =>
              const TenantSelectionScreen(),
        ),
        GoRoute(
          path: '/attendance',
          name: 'attendance',
          builder: (BuildContext context, GoRouterState state) =>
              const AttendanceScreen(),
          routes: <RouteBase>[
            // Push notifications about attendance thresholds deep-link here.
            GoRoute(
              path: 'reports',
              name: 'attendance-reports',
              builder: (BuildContext context, GoRouterState state) =>
                  const AttendanceReportsScreen(),
            ),
          ],
        ),
        GoRoute(
          path: '/students',
          name: 'students',
          builder: (BuildContext context, GoRouterState state) =>
              const StudentsScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'student-profile',
              builder: (BuildContext context, GoRouterState state) =>
                  StudentProfileScreen(
                studentId: state.pathParameters['id'] ?? '',
              ),
              routes: <RouteBase>[
                GoRoute(
                  path: 'enrollments',
                  name: 'student-enrollments',
                  builder: (BuildContext context, GoRouterState state) =>
                      EnrollmentHistoryScreen(
                    studentId: state.pathParameters['id'] ?? '',
                  ),
                ),
                GoRoute(
                  path: 'documents/capture',
                  name: 'student-document-capture',
                  builder: (BuildContext context, GoRouterState state) =>
                      DocumentCaptureScreen(
                    studentId: state.pathParameters['id'] ?? '',
                  ),
                ),
              ],
            ),
          ],
        ),
        GoRoute(
          path: '/institutions',
          name: 'institutions',
          builder: (BuildContext context, GoRouterState state) =>
              const InstitutionsScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'institution-detail',
              builder: (BuildContext context, GoRouterState state) =>
                  InstitutionDetailScreen(
                id: state.pathParameters['id'] ?? '',
              ),
            ),
          ],
        ),
        GoRoute(
          path: '/notifications',
          name: 'notifications',
          builder: (BuildContext context, GoRouterState state) =>
              const NotificationsScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: 'preferences',
              name: 'notification-preferences',
              builder: (BuildContext context, GoRouterState state) =>
                  const NotificationPreferencesScreen(),
            ),
          ],
        ),
        GoRoute(
          path: '/reports',
          name: 'reports',
          builder: (BuildContext context, GoRouterState state) =>
              const ReportsScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'report-detail',
              builder: (BuildContext context, GoRouterState state) =>
                  ReportDetailScreen(id: state.pathParameters['id'] ?? ''),
            ),
          ],
        ),
        GoRoute(
          path: '/assessments',
          name: 'assessments',
          builder: (BuildContext context, GoRouterState state) =>
              const AssessmentHubScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: 'results',
              name: 'assessment-results',
              builder: (BuildContext context, GoRouterState state) =>
                  AssessmentResultsScreen(
                studentId: state.uri.queryParameters['studentId'] ?? '',
                subjectId: state.uri.queryParameters['subjectId'],
                periodId: state.uri.queryParameters['periodId'],
              ),
            ),
          ],
        ),
        GoRoute(
          path: '/examinations',
          name: 'examinations',
          builder: (BuildContext context, GoRouterState state) =>
              ExaminationListScreen(
            studentId: state.uri.queryParameters['studentId'] ?? '',
          ),
          routes: <RouteBase>[
            GoRoute(
              path: 'results',
              name: 'examination-results',
              builder: (BuildContext context, GoRouterState state) =>
                  ExaminationResultsScreen(
                studentId: state.uri.queryParameters['studentId'] ?? '',
                examinationId: state.uri.queryParameters['examinationId'] ??
                    (state.extra is String ? state.extra as String : null),
              ),
            ),
            GoRoute(
              path: ':id',
              name: 'examination-detail',
              builder: (BuildContext context, GoRouterState state) =>
                  ExaminationDetailScreen(
                examinationId: state.pathParameters['id'] ?? '',
                studentId: state.uri.queryParameters['studentId'] ?? '',
              ),
            ),
          ],
        ),
        GoRoute(
          path: '/scholarships',
          name: 'scholarships',
          builder: (BuildContext context, GoRouterState state) =>
              const ScholarshipProgramsScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: 'status',
              name: 'scholarship-status',
              builder: (BuildContext context, GoRouterState state) =>
                  ScholarshipStatusScreen(
                studentId: state.uri.queryParameters['studentId'] ?? '',
              ),
            ),
            GoRoute(
              path: 'apply/:programId',
              name: 'scholarship-apply',
              builder: (BuildContext context, GoRouterState state) =>
                  ScholarshipApplicationScreen(
                programId: state.pathParameters['programId'] ?? '',
                studentId: state.uri.queryParameters['studentId'] ?? '',
              ),
            ),
          ],
        ),
        GoRoute(
          path: '/health',
          name: 'health',
          builder: (BuildContext context, GoRouterState state) =>
              HealthRecordsScreen(
            studentId: state.uri.queryParameters['studentId'] ?? '',
          ),
        ),
        GoRoute(
          path: '/staff',
          name: 'staff',
          builder: (BuildContext context, GoRouterState state) =>
              const StaffListScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'staff-detail',
              builder: (BuildContext context, GoRouterState state) =>
                  StaffDetailScreen(
                staffId: state.pathParameters['id'] ?? '',
              ),
            ),
          ],
        ),
        GoRoute(
          path: '/transport',
          name: 'transport',
          builder: (BuildContext context, GoRouterState state) =>
              const TransportOverviewScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: 'routes',
              name: 'transport-routes',
              builder: (BuildContext context, GoRouterState state) =>
                  const TransportRoutesScreen(),
              routes: <RouteBase>[
                GoRoute(
                  path: ':id',
                  name: 'transport-route-detail',
                  builder: (BuildContext context, GoRouterState state) =>
                      TransportRouteDetailScreen(
                    routeId: state.pathParameters['id'] ?? '',
                  ),
                ),
              ],
            ),
            GoRoute(
              path: 'vehicles',
              name: 'transport-vehicles',
              builder: (BuildContext context, GoRouterState state) =>
                  const TransportVehiclesScreen(),
            ),
            GoRoute(
              path: 'assignments',
              name: 'transport-assignments',
              builder: (BuildContext context, GoRouterState state) =>
                  const TransportAssignmentsScreen(),
            ),
          ],
        ),
        GoRoute(
          path: '/workflows',
          name: 'workflows',
          builder: (BuildContext context, GoRouterState state) =>
              const WorkflowsListScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: 'instances',
              name: 'workflow-instances',
              builder: (BuildContext context, GoRouterState state) =>
                  const WorkflowInstancesScreen(),
            ),
            GoRoute(
              path: 'approvals',
              name: 'workflow-approvals',
              builder: (BuildContext context, GoRouterState state) =>
                  const WorkflowApprovalsScreen(),
            ),
          ],
        ),
        GoRoute(
          path: '/surveys',
          name: 'surveys',
          builder: (BuildContext context, GoRouterState state) =>
              const SurveysListScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: ':id',
              name: 'survey-detail',
              builder: (BuildContext context, GoRouterState state) =>
                  SurveyDetailScreen(
                surveyId: state.pathParameters['id'] ?? '',
              ),
            ),
          ],
        ),
        GoRoute(
          path: '/profile',
          name: 'profile',
          builder: (BuildContext context, GoRouterState state) =>
              const ProfileScreen(),
          routes: <RouteBase>[
            GoRoute(
              path: 'notifications',
              name: 'profile-notifications',
              builder: (BuildContext context, GoRouterState state) =>
                  const NotificationPreferencesScreen(),
            ),
          ],
        ),
      ],
    );
  }

  final AuthBloc _authBloc;
  late final GoRouter _config;

  GoRouter get config => _config;

  String? _redirect(BuildContext context, GoRouterState state) {
    final TenantProvider tenant = getIt<TenantProvider>();
    final AuthState auth = _authBloc.state;
    final String location = state.matchedLocation;

    // Wait for bootstrap before redirecting.
    if (!auth.isResolved) {
      return null;
    }

    final bool atTenant = location == '/tenant';
    final bool atLogin = location == '/login';

    if (!tenant.hasTenant) {
      return atTenant ? null : '/tenant';
    }

    if (!auth.isAuthenticated) {
      return atLogin ? null : '/login';
    }

    // Authenticated users may open /tenant to switch workspaces.
    if (atLogin) {
      return '/';
    }
    return null;
  }
}

/// Bridges [AuthBloc] state changes to a [Listenable] consumed by GoRouter.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(this._bloc) {
    _subscription = _bloc.stream.listen((_) => notifyListeners());
  }

  final AuthBloc _bloc;
  late final StreamSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
