import 'package:dio/dio.dart';

class TransportRoute {
  const TransportRoute({
    required this.id,
    required this.name,
    required this.status,
    required this.startLocation,
    required this.endLocation,
    this.description,
    this.distanceKm,
    this.estimatedDurationMinutes,
    this.departureTime,
    this.returnTime,
  });

  final String id;
  final String name;
  final String status;
  final String startLocation;
  final String endLocation;
  final String? description;
  final num? distanceKm;
  final int? estimatedDurationMinutes;
  final String? departureTime;
  final String? returnTime;

  factory TransportRoute.fromJson(Map<String, dynamic> json) {
    return TransportRoute(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? 'active',
      startLocation: json['startLocation'] as String? ?? '',
      endLocation: json['endLocation'] as String? ?? '',
      description: json['description'] as String?,
      distanceKm: json['distanceKm'] as num?,
      estimatedDurationMinutes: json['estimatedDurationMinutes'] as int?,
      departureTime: json['departureTime'] as String?,
      returnTime: json['returnTime'] as String?,
    );
  }
}

class TransportStop {
  const TransportStop({
    required this.id,
    required this.name,
    required this.stopOrder,
    this.pickupTime,
    this.dropoffTime,
  });

  final String id;
  final String name;
  final int stopOrder;
  final String? pickupTime;
  final String? dropoffTime;

  factory TransportStop.fromJson(Map<String, dynamic> json) {
    return TransportStop(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      stopOrder: json['stopOrder'] as int? ?? 0,
      pickupTime: json['pickupTime'] as String?,
      dropoffTime: json['dropoffTime'] as String?,
    );
  }
}

class TransportVehicle {
  const TransportVehicle({
    required this.id,
    required this.registrationNumber,
    required this.capacity,
    required this.status,
    this.make,
    this.model,
    this.insuranceExpiry,
  });

  final String id;
  final String registrationNumber;
  final int capacity;
  final String status;
  final String? make;
  final String? model;
  final String? insuranceExpiry;

  factory TransportVehicle.fromJson(Map<String, dynamic> json) {
    return TransportVehicle(
      id: json['id'] as String? ?? '',
      registrationNumber: json['registrationNumber'] as String? ?? '',
      capacity: json['capacity'] as int? ?? 0,
      status: json['status'] as String? ?? 'active',
      make: json['make'] as String?,
      model: json['model'] as String?,
      insuranceExpiry: json['insuranceExpiry'] as String?,
    );
  }
}

class StudentRouteAssignment {
  const StudentRouteAssignment({
    required this.id,
    required this.studentId,
    required this.routeId,
    required this.startDate,
    required this.isActive,
    this.stopId,
    this.endDate,
  });

  final String id;
  final String studentId;
  final String routeId;
  final String startDate;
  final bool isActive;
  final String? stopId;
  final String? endDate;

  factory StudentRouteAssignment.fromJson(Map<String, dynamic> json) {
    return StudentRouteAssignment(
      id: json['id'] as String? ?? '',
      studentId: json['studentId'] as String? ?? '',
      routeId: json['routeId'] as String? ?? '',
      startDate: json['startDate'] as String? ?? '',
      isActive: json['isActive'] as bool? ?? true,
      stopId: json['stopId'] as String?,
      endDate: json['endDate'] as String?,
    );
  }
}

class TransportOverview {
  const TransportOverview({
    required this.routes,
    required this.vehicles,
    required this.assignments,
  });

  final List<TransportRoute> routes;
  final List<TransportVehicle> vehicles;
  final List<StudentRouteAssignment> assignments;

  int get activeRouteCount =>
      routes.where((TransportRoute r) => r.status == 'active').length;

  int get activeVehicleCount =>
      vehicles.where((TransportVehicle v) => v.status == 'active').length;

  int get activeAssignmentCount => assignments
      .where((StudentRouteAssignment a) => a.isActive)
      .length;
}

/// Dio client for `/api/v1/transport/*`.
class TransportRepository {
  TransportRepository({required Dio dio}) : _dio = dio;

  final Dio _dio;

  Future<TransportOverview> getOverview() async {
    final List<TransportRoute> routes = await listRoutes();
    final List<TransportVehicle> vehicles = await listVehicles();
    final List<StudentRouteAssignment> assignments = await listAssignments();
    return TransportOverview(
      routes: routes,
      vehicles: vehicles,
      assignments: assignments,
    );
  }

  Future<List<TransportRoute>> listRoutes({String? search}) async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/transport/routes',
        queryParameters: <String, dynamic>{
          'pageSize': 100,
          if (search != null && search.isNotEmpty) 'search': search,
        },
      );
      return _unwrapList(response.data)
          .map(TransportRoute.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <TransportRoute>[];
    }
  }

  Future<TransportRoute?> getRoute(String id) async {
    try {
      final Response<dynamic> response =
          await _dio.get('/api/v1/transport/routes/$id');
      final Object? raw = response.data;
      if (raw is! Map) return null;
      return TransportRoute.fromJson(Map<String, dynamic>.from(raw));
    } on DioException {
      return null;
    }
  }

  Future<List<TransportStop>> listStops(String routeId) async {
    try {
      final Response<dynamic> response =
          await _dio.get('/api/v1/transport/routes/$routeId/stops');
      return _unwrapList(response.data)
          .map(TransportStop.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <TransportStop>[];
    }
  }

  Future<List<TransportVehicle>> listVehicles() async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/transport/vehicles',
        queryParameters: const <String, dynamic>{'pageSize': 100},
      );
      return _unwrapList(response.data)
          .map(TransportVehicle.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <TransportVehicle>[];
    }
  }

  Future<List<StudentRouteAssignment>> listAssignments({String? routeId}) async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/transport/student-assignments',
        queryParameters: <String, dynamic>{
          'pageSize': 100,
          'routeId': ?routeId,
        },
      );
      return _unwrapList(response.data)
          .map(StudentRouteAssignment.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <StudentRouteAssignment>[];
    }
  }

  List<Map<String, dynamic>> _unwrapList(dynamic payload) {
    if (payload == null) return const <Map<String, dynamic>>[];
    if (payload is List) {
      return payload
          .whereType<Map>()
          .map((Map e) => Map<String, dynamic>.from(e))
          .toList(growable: false);
    }
    if (payload is Map && payload['data'] is List) {
      return (payload['data'] as List)
          .whereType<Map>()
          .map((Map e) => Map<String, dynamic>.from(e))
          .toList(growable: false);
    }
    return const <Map<String, dynamic>>[];
  }
}
