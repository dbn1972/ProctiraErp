import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/scholarship/presentation/scholarship_date_format.dart';

/// PRC-L214: a short/malformed server date must not crash the list.
void main() {
  test('formats a full ISO timestamp to YYYY-MM-DD', () {
    expect(
      formatScholarshipStepDate('2026-03-01T09:00:00.000Z'),
      '2026-03-01',
    );
  });

  test('formats a date-only string', () {
    expect(formatScholarshipStepDate('2026-03-01'), '2026-03-01');
  });

  test('does not throw on a short string (previously RangeError)', () {
    expect(() => formatScholarshipStepDate('2026'), returnsNormally);
    expect(formatScholarshipStepDate('2026'), '2026');
  });

  test('returns raw value for a non-date string', () {
    expect(formatScholarshipStepDate('n/a'), 'n/a');
  });
}
