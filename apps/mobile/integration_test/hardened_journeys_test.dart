/// Journeys that assert real behaviour (router path, stored tokens, contract
/// stubs) and run headless on `flutter-tester` in CI:
///
///   flutter test -d flutter-tester integration_test/hardened_journeys_test.dart
///
/// PRC-M563/M564/M565/M567. The legacy attendance + student-enrollment
/// journeys still seed plaintext cache rows (refused by CacheCrypto) and stay
/// in `app_test.dart` until they are reseeded through the repositories.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey_notification_deep_link_test.dart' as notifications;
import 'journey_tenant_cache_scoping_test.dart' as tenants;
import 'journey_tenant_selection_test.dart' as tenant_selection;
import 'login_flow_test.dart' as login;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  group('login', login.main);
  group('notification deep-link', notifications.main);
  group('tenant cache scoping + contract', tenants.main);
  group('workspace selection', tenant_selection.main);
}
