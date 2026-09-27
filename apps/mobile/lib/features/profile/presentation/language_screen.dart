import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/l10n/app_localizations.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Device-local language picker. There is no account-level locale API on mobile.
class LanguageScreen extends StatelessWidget {
  const LanguageScreen({super.key});

  static const List<Locale> _choices = AppLocalizations.supportedLocales;

  @override
  Widget build(BuildContext context) {
    final TenantProvider tenant = getIt<TenantProvider>();
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: Text(l10n.language)),
      ),
      body: ListenableBuilder(
        listenable: tenant,
        builder: (BuildContext context, _) {
          final String? selected = tenant.locale?.languageCode;
          return RadioGroup<String?>(
            groupValue: selected,
            onChanged: (String? code) {
              unawaited(
                tenant.setLocale(code == null ? null : Locale(code)),
              );
            },
            child: ListView(
              children: <Widget>[
                const _HonestyNote(
                  text:
                      'Language is saved on this device. It is not synced to your account.',
                ),
                const RadioListTile<String?>(
                  value: null,
                  title: Text('Device default'),
                ),
                ..._choices.map((Locale locale) {
                  return RadioListTile<String?>(
                    value: locale.languageCode,
                    title: Text(_label(locale.languageCode)),
                  );
                }),
              ],
            ),
          );
        },
      ),
    );
  }

  static String _label(String code) {
    switch (code) {
      case 'hi':
        return 'हिन्दी';
      case 'ta':
        return 'தமிழ்';
      case 'te':
        return 'తెలుగు';
      case 'mr':
        return 'मराठी';
      case 'bn':
        return 'বাংলা';
      case 'gu':
        return 'ગુજરાતી';
      case 'kn':
        return 'ಕನ್ನಡ';
      case 'ar':
        return 'العربية';
      default:
        return 'English';
    }
  }
}

class _HonestyNote extends StatelessWidget {
  const _HonestyNote({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        text,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
