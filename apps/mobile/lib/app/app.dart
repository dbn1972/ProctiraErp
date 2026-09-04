import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../core/auth/auth_bloc.dart';
import '../core/di/injector.dart';
import '../core/l10n/app_localizations.dart';
import '../core/router/app_router.dart';
import '../core/tenant/tenant_provider.dart';
import '../core/theme/app_theme.dart';

/// Tenant-aware MaterialApp wrapper.
///
/// Reads the active tenant from [TenantProvider] and applies the ProctiraERP
/// design tokens (navy primary, teal accent, Inter font) on top of Material 3.
/// Supports light/dark themes and all 9 locales (en, hi, ta, te, mr, bn, gu, kn, ar).
class OpenEmisApp extends StatelessWidget {
  const OpenEmisApp({super.key});

  @override
  Widget build(BuildContext context) {
    final TenantProvider tenantProvider = getIt<TenantProvider>();
    final AppRouter routerFactory = getIt<AppRouter>();

    return MultiBlocProvider(
      providers: <BlocProvider<dynamic>>[
        BlocProvider<AuthBloc>.value(value: getIt<AuthBloc>()),
      ],
      child: ListenableBuilder(
        listenable: tenantProvider,
        builder: (BuildContext context, _) {
          // Extract tenant brand colors if configured.
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
    );
  }
}
