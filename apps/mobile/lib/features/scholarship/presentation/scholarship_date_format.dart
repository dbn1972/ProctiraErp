/// PRC-L214: safe ISO-date rendering for scholarship timelines.
///
/// A short or malformed server date string must never crash the applications
/// list via a `substring` RangeError. Parses to a calendar date when possible
/// and otherwise returns the raw value unharmed.
String formatScholarshipStepDate(String raw) {
  final DateTime? parsed = DateTime.tryParse(raw);
  if (parsed != null) {
    final String y = parsed.year.toString().padLeft(4, '0');
    final String m = parsed.month.toString().padLeft(2, '0');
    final String d = parsed.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }
  return raw.length >= 10 ? raw.substring(0, 10) : raw;
}
