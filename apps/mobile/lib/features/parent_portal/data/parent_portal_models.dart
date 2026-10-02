import 'package:intl/intl.dart';

/// Linked child returned by `GET /parent-portal/children`.
///
/// Name and class are filled from the link payload when the API includes them,
/// otherwise from the student record and the parent timetable view.
class LinkedChild {
  const LinkedChild({
    required this.linkId,
    required this.studentId,
    required this.relationship,
    required this.status,
    this.givenName,
    this.className,
  });

  final String linkId;
  final String studentId;
  final String relationship;
  final String status;
  final String? givenName;
  final String? className;

  String get nameLabel {
    final String name = givenName?.trim() ?? '';
    return name.isEmpty ? 'Name unavailable' : name;
  }

  String get classLabel {
    final String label = className?.trim() ?? '';
    return label.isEmpty ? 'Class unavailable' : label;
  }

  LinkedChild copyWith({String? givenName, String? className}) {
    return LinkedChild(
      linkId: linkId,
      studentId: studentId,
      relationship: relationship,
      status: status,
      givenName: givenName ?? this.givenName,
      className: className ?? this.className,
    );
  }
}

class ParentMessageThread {
  const ParentMessageThread({
    required this.id,
    required this.studentId,
    required this.subject,
    required this.status,
  });

  final String id;
  final String studentId;
  final String subject;
  final String status;
}

class ParentConsent {
  const ParentConsent({
    required this.id,
    required this.studentId,
    required this.title,
    required this.status,
    required this.consentType,
  });

  final String id;
  final String studentId;
  final String title;
  final String status;
  final String consentType;
}

class ParentInvoice {
  const ParentInvoice({
    required this.id,
    required this.studentId,
    required this.title,
    required this.status,
    required this.amountCents,
    required this.currency,
  });

  final String id;
  final String studentId;
  final String title;
  final String status;

  /// Minor units. `null` when the server sent a missing or non-numeric
  /// amount; never coerced to 0 so a broken payload is not shown as "paid"
  /// (PRC-L012).
  final int? amountCents;
  final String currency;

  bool get hasValidAmount => amountCents != null;

  /// Locale-aware money label with currency symbol (e.g. `₹1,23,450.00`).
  String get amountLabel {
    final int? cents = amountCents;
    if (cents == null) {
      return 'Amount unavailable';
    }
    final String code = currency.trim().toUpperCase();
    final NumberFormat format = code.isEmpty
        ? NumberFormat.decimalPatternDigits(locale: 'en_IN', decimalDigits: 2)
        : NumberFormat.simpleCurrency(
            name: code,
            locale: code == 'INR' ? 'en_IN' : null,
          );
    return format.format(cents / 100);
  }
}

/// Row rendered by the parent messages, consents, and fees screens.
class ParentPortalRow {
  const ParentPortalRow({required this.title, required this.subtitle});

  final String title;
  final String subtitle;
}
