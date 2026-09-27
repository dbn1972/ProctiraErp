import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/notifications/data/local_notification_preferences.dart';

void main() {
  test('round-trips notification preferences', () {
    const LocalNotificationPreferences prefs = LocalNotificationPreferences(
      pushEnabled: false,
      reportReady: false,
    );
    final LocalNotificationPreferences restored =
        LocalNotificationPreferences.fromJson(prefs.toJson());
    expect(restored.pushEnabled, isFalse);
    expect(restored.reportReady, isFalse);
    expect(restored.emailEnabled, isTrue);
  });

  test('ignores non-boolean stored values', () {
    final LocalNotificationPreferences restored =
        LocalNotificationPreferences.fromJson(<String, dynamic>{
      'pushEnabled': 'yes',
      'emailEnabled': false,
    });
    expect(restored.pushEnabled, isTrue);
    expect(restored.emailEnabled, isFalse);
  });
}
