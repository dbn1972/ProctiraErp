import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Default geofence radius (meters). Marks recorded outside this radius show a
/// banner warning but are still saved for backend audit.
const double kAttendanceGeofenceRadiusMeters = 200;

/// Result of resolving a user's location against an institution geofence.
class GeofenceCheck {
  const GeofenceCheck({
    required this.status,
    this.userPosition,
    this.institutionLatitude,
    this.institutionLongitude,
    this.distanceMeters,
    this.message,
  });

  final GeofenceStatus status;
  final Position? userPosition;
  final double? institutionLatitude;
  final double? institutionLongitude;
  final double? distanceMeters;
  final String? message;

  bool get inside => status == GeofenceStatus.insideRadius;
  bool get outside => status == GeofenceStatus.outsideRadius;
}

enum GeofenceStatus {
  /// Permission was denied or service is disabled.
  permissionDenied,

  /// We have GPS but the institution does not have coordinates configured —
  /// nothing to compare against.
  institutionLocationUnknown,

  /// Inside the geofence radius. Attendance can be marked without warning.
  insideRadius,

  /// Outside the geofence radius. The UI should still allow saving but
  /// surface a warning banner.
  outsideRadius,

  /// Unable to determine due to an unexpected error.
  unavailable,
}

/// Strategy used by [AttendanceGeofenceWidget] to obtain the GPS coordinates
/// of the institution. Production wires this through [_AppGeofenceLocator]
/// (cache-first then [InstitutionApi]); tests inject a fake.
abstract class GeofenceLocator {
  Future<({double? latitude, double? longitude, String? name})> locate(
    String institutionId,
  );
}

class _AppGeofenceLocator implements GeofenceLocator {
  _AppGeofenceLocator(this._database, this._tenantProvider, this._api);

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final InstitutionApi _api;

  @override
  Future<({double? latitude, double? longitude, String? name})> locate(
    String institutionId,
  ) async {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null) {
      return (latitude: null, longitude: null, name: null);
    }
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'institutions_cache',
      where: 'tenant_id = ? AND id = ?',
      whereArgs: <Object>[tenantId, institutionId],
      limit: 1,
    );

    if (rows.isNotEmpty) {
      final Map<String, Object?> row = rows.first;
      return (
        latitude: (row['latitude'] as num?)?.toDouble(),
        longitude: (row['longitude'] as num?)?.toDouble(),
        name: row['name'] as String?,
      );
    }

    try {
      final Institution remote = await _api.fetchInstitution(institutionId);
      // Persist a thin cache row so the next launch can answer from disk.
      final Map<String, dynamic> raw = <String, dynamic>{
        'id': remote.id,
        'name': remote.name,
        'code': remote.code,
        'areaId': remote.areaId,
        'type': remote.type,
        'sector': remote.sector,
        'ownership': remote.ownership,
        'status': remote.status,
        'createdAt': remote.createdAt,
        'updatedAt': remote.updatedAt,
      };
      await db.insert(
        'institutions_cache',
        <String, Object?>{
          'id': remote.id,
          'tenant_id': tenantId,
          'name': remote.name,
          'code': remote.code,
          'latitude': null,
          'longitude': null,
          'payload': jsonEncode(raw),
          'updated_at': DateTime.now().millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      return (latitude: null, longitude: null, name: remote.name);
    } on ApiException {
      return (latitude: null, longitude: null, name: null);
    }
  }
}

/// Builds a [GeofenceLocator] backed by the live SQLite cache + API client.
GeofenceLocator buildAppGeofenceLocator() {
  return _AppGeofenceLocator(
    getIt<AppDatabase>(),
    getIt<TenantProvider>(),
    getIt<InstitutionApi>(),
  );
}

/// Banner shown above the attendance roster. Prompts for location permission
/// and continuously displays an inside / outside radius indicator.
class AttendanceGeofenceWidget extends StatefulWidget {
  const AttendanceGeofenceWidget({
    super.key,
    required this.institutionId,
    required this.locator,
    this.radiusMeters = kAttendanceGeofenceRadiusMeters,
    this.onCheck,
    @visibleForTesting GeoPlatform? platform,
  }) : _platform = platform;

  final String institutionId;
  final GeofenceLocator locator;
  final double radiusMeters;
  final void Function(GeofenceCheck check)? onCheck;
  final GeoPlatform? _platform;

  @override
  State<AttendanceGeofenceWidget> createState() => _AttendanceGeofenceWidgetState();
}

class _AttendanceGeofenceWidgetState extends State<AttendanceGeofenceWidget> {
  GeofenceCheck? _check;
  bool _loading = true;

  GeoPlatform get _geo => widget._platform ?? const _RealGeoPlatform();

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final GeofenceCheck check = await _resolve();
    if (!mounted) return;
    setState(() {
      _check = check;
      _loading = false;
    });
    widget.onCheck?.call(check);
  }

  Future<GeofenceCheck> _resolve() async {
    try {
      final bool serviceEnabled = await _geo.isLocationServiceEnabled();
      if (!serviceEnabled) {
        return const GeofenceCheck(
          status: GeofenceStatus.permissionDenied,
          message: 'Location services are disabled. Enable them to validate attendance location.',
        );
      }

      LocationPermission permission = await _geo.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await _geo.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return const GeofenceCheck(
          status: GeofenceStatus.permissionDenied,
          message: 'Location permission denied. Attendance can still be saved without geo validation.',
        );
      }

      final ({double? latitude, double? longitude, String? name}) institution =
          await widget.locator.locate(widget.institutionId);

      final Position position = await _geo.getCurrentPosition();

      if (institution.latitude == null || institution.longitude == null) {
        return GeofenceCheck(
          status: GeofenceStatus.institutionLocationUnknown,
          userPosition: position,
          message:
              'No GPS coordinates configured for ${institution.name ?? 'this institution'}.',
        );
      }

      final double distance = _haversineMeters(
        position.latitude,
        position.longitude,
        institution.latitude!,
        institution.longitude!,
      );

      final bool inside = distance <= widget.radiusMeters;
      return GeofenceCheck(
        status: inside ? GeofenceStatus.insideRadius : GeofenceStatus.outsideRadius,
        userPosition: position,
        institutionLatitude: institution.latitude,
        institutionLongitude: institution.longitude,
        distanceMeters: distance,
        message: inside
            ? 'You are within the ${widget.radiusMeters.toStringAsFixed(0)} m geofence.'
            : 'You are ${distance.toStringAsFixed(0)} m from the institution. '
                'Attendance will still be recorded, but the location is logged for audit.',
      );
    } catch (error) {
      return GeofenceCheck(
        status: GeofenceStatus.unavailable,
        message: 'Unable to determine your location: $error',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    if (_loading) {
      return Card(
        margin: const EdgeInsets.symmetric(vertical: 8),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: <Widget>[
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 12),
              Text('Checking attendance location…',
                  style: theme.textTheme.bodyMedium),
            ],
          ),
        ),
      );
    }

    final GeofenceCheck? check = _check;
    if (check == null) return const SizedBox.shrink();

    final (Color background, IconData icon, Color foreground) style = switch (check.status) {
      GeofenceStatus.insideRadius => (
        theme.colorScheme.primaryContainer,
        Icons.check_circle,
        theme.colorScheme.onPrimaryContainer,
      ),
      GeofenceStatus.outsideRadius => (
        theme.colorScheme.errorContainer,
        Icons.warning_amber_rounded,
        theme.colorScheme.onErrorContainer,
      ),
      GeofenceStatus.institutionLocationUnknown => (
        theme.colorScheme.surfaceContainerHighest,
        Icons.location_off,
        theme.colorScheme.onSurface,
      ),
      GeofenceStatus.permissionDenied => (
        theme.colorScheme.tertiaryContainer,
        Icons.location_disabled,
        theme.colorScheme.onTertiaryContainer,
      ),
      GeofenceStatus.unavailable => (
        theme.colorScheme.surfaceContainerHighest,
        Icons.error_outline,
        theme.colorScheme.onSurface,
      ),
    };

    return Card(
      color: style.$1,
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: <Widget>[
            Icon(style.$2, color: style.$3),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                check.message ?? '',
                style: theme.textTheme.bodyMedium?.copyWith(color: style.$3),
              ),
            ),
            IconButton(
              icon: Icon(Icons.refresh, color: style.$3),
              tooltip: 'Re-check location',
              onPressed: _refresh,
            ),
          ],
        ),
      ),
    );
  }
}

/// Internal abstraction over the `geolocator` static API. Production uses
/// [_RealGeoPlatform]; tests can substitute a fake without depending on the
/// real plugin.
abstract class GeoPlatform {
  Future<bool> isLocationServiceEnabled();
  Future<LocationPermission> checkPermission();
  Future<LocationPermission> requestPermission();
  Future<Position> getCurrentPosition();
}

class _RealGeoPlatform implements GeoPlatform {
  const _RealGeoPlatform();

  @override
  Future<bool> isLocationServiceEnabled() =>
      Geolocator.isLocationServiceEnabled();

  @override
  Future<LocationPermission> checkPermission() => Geolocator.checkPermission();

  @override
  Future<LocationPermission> requestPermission() =>
      Geolocator.requestPermission();

  @override
  Future<Position> getCurrentPosition() => Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
}

/// Great-circle distance in meters between two coordinates.
double _haversineMeters(double lat1, double lon1, double lat2, double lon2) {
  const double earthRadius = 6371000; // meters
  final double dLat = _radians(lat2 - lat1);
  final double dLon = _radians(lon2 - lon1);
  final double a = math.pow(math.sin(dLat / 2), 2).toDouble() +
      math.cos(_radians(lat1)) *
          math.cos(_radians(lat2)) *
          math.pow(math.sin(dLon / 2), 2).toDouble();
  final double c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  return earthRadius * c;
}

double _radians(double degrees) => degrees * math.pi / 180.0;
