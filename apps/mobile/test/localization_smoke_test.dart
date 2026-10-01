import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';

/// PRC-L007 locale smoke test: every supported locale resolves every key
/// (no raw key fallback) and no legacy OpenEMIS branding remains.
void main() {
  List<String> values(AppLocalizations l) => <String>[
    l.appTitle,
    l.home,
    l.attendance,
    l.students,
    l.institutions,
    l.notifications,
    l.reports,
    l.assessments,
    l.examinations,
    l.scholarships,
    l.healthRecords,
    l.profile,
    l.settings,
    l.login,
    l.logout,
    l.loading,
    l.retry,
    l.error,
    l.noData,
    l.save,
    l.cancel,
    l.submit,
    l.language,
    l.theme,
    l.lightTheme,
    l.darkTheme,
    l.systemTheme,
    l.notificationPreferences,
    l.offline,
    l.syncing,
    l.syncComplete,
    l.conflictDetected,
    l.keepLocal,
    l.keepServer,
    l.upcoming,
    l.results,
    l.apply,
    l.status,
    l.pending,
    l.approved,
    l.rejected,
  ];

  for (final Locale locale in AppLocalizations.supportedLocales) {
    test('locale ${locale.languageCode} resolves all keys with ProctiraERP '
        'branding', () {
      final AppLocalizations l = AppLocalizations(locale);
      expect(l.appTitle, 'ProctiraERP');
      for (final String v in values(l)) {
        expect(v.trim(), isNotEmpty);
        expect(v.toLowerCase(), isNot(contains('openemis')));
      }
    });
  }

  test('non-English locales are actually translated for core nav keys', () {
    final AppLocalizations en = AppLocalizations(const Locale('en'));
    for (final Locale locale in AppLocalizations.supportedLocales) {
      if (locale.languageCode == 'en') continue;
      final AppLocalizations l = AppLocalizations(locale);
      expect(l.home, isNot(en.home), reason: locale.languageCode);
      expect(l.students, isNot(en.students), reason: locale.languageCode);
    }
  });
}
