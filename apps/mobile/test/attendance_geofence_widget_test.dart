import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:proctira_mobile/features/attendance/presentation/attendance_geofence_widget.dart';

/// Fake [GeofenceLocator] returning fixed coordinates (or none) for an
/// institution, without touching SQLite or the API client.
class _FakeLocator implements GeofenceLocator {
  _FakeLocator({this.latitude, this.longitude});

  final double? latitude;
  final double? longitude;

  @override
  Future<({double? latitude, double? longitude, String? name})> locate(
    String institutionId,
  ) async {
    return (latitude: latitude, longitude: longitude, name: null);
  }
}

/// Fake [GeoPlatform] that reports the device as enabled/granted and parked
/// at a fixed position.
class _FakeGeoPlatform implements GeoPlatform {
  _FakeGeoPlatform({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;

  @override
  Future<bool> isLocationServiceEnabled() async => true;

  @override
  Future<LocationPermission> checkPermission() async =>
      LocationPermission.whileInUse;

  @override
  Future<LocationPermission> requestPermission() async =>
      LocationPermission.whileInUse;

  @override
  Future<Position> getCurrentPosition() async => Position(
    latitude: latitude,
    longitude: longitude,
    timestamp: DateTime.utc(2026, 1, 1),
    accuracy: 5,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
  );
}

void main() {
  testWidgets(
    'PRC-M468: renders insideRadius when the institution has coordinates '
    'and the user is close by',
    (WidgetTester tester) async {
      GeofenceCheck? reported;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AttendanceGeofenceWidget(
              institutionId: 'inst-1',
              locator: _FakeLocator(latitude: 1.0, longitude: 2.0),
              onCheck: (GeofenceCheck check) => reported = check,
              platform: _FakeGeoPlatform(latitude: 1.0, longitude: 2.0),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(reported, isNotNull);
      expect(reported!.status, GeofenceStatus.insideRadius);
      expect(find.textContaining('within the'), findsOneWidget);
    },
  );

  testWidgets(
    'PRC-M468: renders outsideRadius when the institution has coordinates '
    'but the user is far away',
    (WidgetTester tester) async {
      GeofenceCheck? reported;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AttendanceGeofenceWidget(
              institutionId: 'inst-1',
              locator: _FakeLocator(latitude: 1.0, longitude: 2.0),
              onCheck: (GeofenceCheck check) => reported = check,
              platform: _FakeGeoPlatform(latitude: 10.0, longitude: 20.0),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(reported, isNotNull);
      expect(reported!.status, GeofenceStatus.outsideRadius);
      expect(find.textContaining('m from the institution'), findsOneWidget);
    },
  );

  testWidgets('renders institutionLocationUnknown when the institution has no '
      'coordinates', (WidgetTester tester) async {
    GeofenceCheck? reported;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AttendanceGeofenceWidget(
            institutionId: 'inst-1',
            locator: _FakeLocator(),
            onCheck: (GeofenceCheck check) => reported = check,
            platform: _FakeGeoPlatform(latitude: 1.0, longitude: 2.0),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(reported, isNotNull);
    expect(reported!.status, GeofenceStatus.institutionLocationUnknown);
    expect(
      find.textContaining('No GPS coordinates configured'),
      findsOneWidget,
    );
  });
}
