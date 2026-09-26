import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/l10n/app_localizations.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Device-local theme picker. The choice is not written to an account API.
class ThemeScreen extends StatelessWidget {
  const ThemeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final TenantProvider tenant = getIt<TenantProvider>();
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: Text(l10n.theme)),
      ),
      body: ListenableBuilder(
        listenable: tenant,
        builder: (BuildContext context, _) {
          return RadioGroup<ThemeMode>(
            groupValue: tenant.themeMode,
            onChanged: (ThemeMode? mode) {
              if (mode == null) {
                return;
              }
              unawaited(tenant.setThemeMode(mode));
            },
            child: ListView(
              children: <Widget>[
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Theme is saved on this device. It is not synced to your account.',
                  ),
                ),
                RadioListTile<ThemeMode>(
                  value: ThemeMode.system,
                  title: Text(l10n.systemTheme),
                ),
                RadioListTile<ThemeMode>(
                  value: ThemeMode.light,
                  title: Text(l10n.lightTheme),
                ),
                RadioListTile<ThemeMode>(
                  value: ThemeMode.dark,
                  title: Text(l10n.darkTheme),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
