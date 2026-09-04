import 'package:dio/dio.dart';

/// Staff member summary used by list + detail screens.
class StaffMember {
  const StaffMember({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.position,
    required this.status,
    this.identityNumber,
    this.contactPhone,
    this.contactEmail,
    this.dateOfBirth,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String position;
  final String status;
  final String? identityNumber;
  final String? contactPhone;
  final String? contactEmail;
  final String? dateOfBirth;

  String get fullName => '$firstName $lastName'.trim();

  factory StaffMember.fromJson(Map<String, dynamic> json) {
    return StaffMember(
      id: json['id'] as String? ?? '',
      firstName: json['firstName'] as String? ?? '',
      lastName: json['lastName'] as String? ?? '',
      position: json['position'] as String? ?? '',
      status: json['status'] as String? ?? 'ACTIVE',
      identityNumber: json['identityNumber'] as String?,
      contactPhone: json['contactPhone'] as String?,
      contactEmail: json['contactEmail'] as String?,
      dateOfBirth: json['dateOfBirth'] as String?,
    );
  }
}

class StaffAppraisal {
  const StaffAppraisal({
    required this.id,
    required this.appraisalDate,
    required this.totalScore,
    required this.status,
    this.overallComment,
  });

  final String id;
  final String appraisalDate;
  final num totalScore;
  final String status;
  final String? overallComment;

  factory StaffAppraisal.fromJson(Map<String, dynamic> json) {
    return StaffAppraisal(
      id: json['id'] as String? ?? '',
      appraisalDate: json['appraisalDate'] as String? ?? '',
      totalScore: json['totalScore'] as num? ?? 0,
      status: json['status'] as String? ?? '',
      overallComment: json['overallComment'] as String?,
    );
  }
}

class StaffCertification {
  const StaffCertification({
    required this.id,
    required this.certificationName,
    required this.issuedDate,
    required this.status,
    this.expiryDate,
  });

  final String id;
  final String certificationName;
  final String issuedDate;
  final String status;
  final String? expiryDate;

  factory StaffCertification.fromJson(Map<String, dynamic> json) {
    return StaffCertification(
      id: json['id'] as String? ?? '',
      certificationName: json['certificationName'] as String? ?? '',
      issuedDate: json['issuedDate'] as String? ?? '',
      status: json['status'] as String? ?? '',
      expiryDate: json['expiryDate'] as String?,
    );
  }
}

class StaffDetailBundle {
  const StaffDetailBundle({
    required this.staff,
    this.appraisals = const <StaffAppraisal>[],
    this.certifications = const <StaffCertification>[],
  });

  final StaffMember staff;
  final List<StaffAppraisal> appraisals;
  final List<StaffCertification> certifications;
}

/// Dio client for `/api/v1/staff` (+ appraisals / training).
class StaffRepository {
  StaffRepository({required Dio dio}) : _dio = dio;

  final Dio _dio;

  Future<List<StaffMember>> listStaff({String? search}) async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/staff',
        queryParameters: <String, dynamic>{
          'pageSize': 100,
          if (search != null && search.isNotEmpty) 'search': search,
        },
      );
      return _unwrapList(response.data)
          .map(StaffMember.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <StaffMember>[];
    }
  }

  Future<StaffDetailBundle?> getStaffDetail(String id) async {
    try {
      final Response<dynamic> response = await _dio.get('/api/v1/staff/$id');
      final Object? raw = response.data;
      if (raw is! Map) return null;
      final StaffMember staff =
          StaffMember.fromJson(Map<String, dynamic>.from(raw));

      final List<StaffAppraisal> appraisals = await _listAppraisals(id);
      final List<StaffCertification> certifications =
          await _listCertifications(id);
      return StaffDetailBundle(
        staff: staff,
        appraisals: appraisals,
        certifications: certifications,
      );
    } on DioException {
      return null;
    }
  }

  Future<List<StaffAppraisal>> _listAppraisals(String staffId) async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/staff/appraisals',
        queryParameters: <String, dynamic>{
          'staffId': staffId,
          'pageSize': 100,
        },
      );
      return _unwrapList(response.data)
          .map(StaffAppraisal.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <StaffAppraisal>[];
    }
  }

  Future<List<StaffCertification>> _listCertifications(String staffId) async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/staff/training/certifications',
        queryParameters: <String, dynamic>{
          'staffId': staffId,
          'pageSize': 100,
        },
      );
      return _unwrapList(response.data)
          .map(StaffCertification.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <StaffCertification>[];
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
