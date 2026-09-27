/// Notification choices stored on the device.
///
/// The mobile API client has no preferences write endpoint, so these values
/// must not be described as an account or cloud save.
class LocalNotificationPreferences {
  const LocalNotificationPreferences({
    this.pushEnabled = true,
    this.emailEnabled = true,
    this.inAppEnabled = true,
    this.attendanceAlerts = true,
    this.workflowApprovals = true,
    this.reportReady = true,
    this.examResults = true,
    this.studentTransfers = true,
    this.systemAnnouncements = true,
  });

  final bool pushEnabled;
  final bool emailEnabled;
  final bool inAppEnabled;
  final bool attendanceAlerts;
  final bool workflowApprovals;
  final bool reportReady;
  final bool examResults;
  final bool studentTransfers;
  final bool systemAnnouncements;

  LocalNotificationPreferences copyWith({
    bool? pushEnabled,
    bool? emailEnabled,
    bool? inAppEnabled,
    bool? attendanceAlerts,
    bool? workflowApprovals,
    bool? reportReady,
    bool? examResults,
    bool? studentTransfers,
    bool? systemAnnouncements,
  }) {
    return LocalNotificationPreferences(
      pushEnabled: pushEnabled ?? this.pushEnabled,
      emailEnabled: emailEnabled ?? this.emailEnabled,
      inAppEnabled: inAppEnabled ?? this.inAppEnabled,
      attendanceAlerts: attendanceAlerts ?? this.attendanceAlerts,
      workflowApprovals: workflowApprovals ?? this.workflowApprovals,
      reportReady: reportReady ?? this.reportReady,
      examResults: examResults ?? this.examResults,
      studentTransfers: studentTransfers ?? this.studentTransfers,
      systemAnnouncements: systemAnnouncements ?? this.systemAnnouncements,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'pushEnabled': pushEnabled,
        'emailEnabled': emailEnabled,
        'inAppEnabled': inAppEnabled,
        'attendanceAlerts': attendanceAlerts,
        'workflowApprovals': workflowApprovals,
        'reportReady': reportReady,
        'examResults': examResults,
        'studentTransfers': studentTransfers,
        'systemAnnouncements': systemAnnouncements,
      };

  factory LocalNotificationPreferences.fromJson(Map<String, dynamic> json) {
    bool read(String key, bool fallback) {
      final Object? value = json[key];
      return value is bool ? value : fallback;
    }

    const LocalNotificationPreferences defaults = LocalNotificationPreferences();
    return LocalNotificationPreferences(
      pushEnabled: read('pushEnabled', defaults.pushEnabled),
      emailEnabled: read('emailEnabled', defaults.emailEnabled),
      inAppEnabled: read('inAppEnabled', defaults.inAppEnabled),
      attendanceAlerts: read('attendanceAlerts', defaults.attendanceAlerts),
      workflowApprovals: read('workflowApprovals', defaults.workflowApprovals),
      reportReady: read('reportReady', defaults.reportReady),
      examResults: read('examResults', defaults.examResults),
      studentTransfers: read('studentTransfers', defaults.studentTransfers),
      systemAnnouncements:
          read('systemAnnouncements', defaults.systemAnnouncements),
    );
  }
}
