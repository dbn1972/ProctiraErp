import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../core/auth/auth_bloc.dart';
import '../core/di/injector.dart';
import '../core/l10n/app_localizations.dart';
import '../core/router/app_router.dart';
import '../core/tenant/tenant_provider.dart';
import '../core/theme/app_theme.dart';
import '../features/assessment/data/assessment_repository.dart';
import '../features/examination/data/examination_repository.dart';
import '../features/health/data/health_repository.dart';
import '../features/scholarship/data/scholarship_repository.dart';

/// Tenant-aware MaterialApp wrapper.
///
/// Reads the active tenant from [TenantProvider] and applies ProctiraERP
/// design tokens on top of Material 3. Provides domain repositories that
/// feature screens resolve via `context.read`.
class OpenEmisApp extends StatelessWidget {
  const OpenEmisApp({super.key});

  @override
  Widget build(BuildContext context) {
    final TenantProvider tenantProvider = getIt<TenantProvider>();
    final AppRouter routerFactory = getIt<AppRouter>();

    return MultiRepositoryProvider(
      providers: <RepositoryProvider<dynamic>>[
        RepositoryProvider<ScholarshipRepository>.value(
          value: getIt<ScholarshipRepository>(),
        ),
        RepositoryProvider<HealthRepository>.value(
          value: getIt<HealthRepository>(),
        ),
        RepositoryProvider<ExaminationRepository>.value(
          value: getIt<ExaminationRepository>(),
        ),
        RepositoryProvider<AssessmentRepository>.value(
          value: getIt<AssessmentRepository>(),
        ),
      ],
      child: MultiBlocProvider(
        providers: <BlocProvider<dynamic>>[
          BlocProvider<AuthBloc>.value(value: getIt<AuthBloc>()),
        ],
        child: ListenableBuilder(
          listenable: tenantProvider,
          builder: (BuildContext context, _) {
            final Color? primaryColor = tenantProvider.primaryColor;
            final Color? secondaryColor = tenantProvider.secondaryColor;

            return MaterialApp.router(
              title: tenantProvider.displayName ?? 'ProctiraERP',
              debugShowCheckedModeBanner: false,
              theme: AppTheme.light(
                primaryColor: primaryColor,
                secondaryColor: secondaryColor,
              ),
              darkTheme: AppTheme.dark(
                primaryColor: primaryColor,
                secondaryColor: secondaryColor,
              ),
              themeMode: ThemeMode.system,
              routerConfig: routerFactory.config,
              localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
                AppLocalizations.delegate,
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
              supportedLocales: AppLocalizations.supportedLocales,
              locale: tenantProvider.locale,
            );
          },
        ),
      ),
    );
  }
}
