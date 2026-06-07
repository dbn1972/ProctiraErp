import 'package:meta/meta.dart';

import 'versioned.dart';

/// DTO mirroring `InstitutionResponseSchema` (subset used by the mobile app).
@immutable
class Institution implements Versioned {
  const Institution({
    required this.id,
    required this.name,
    required this.code,
    this.areaId,
    this.type,
    this.sector,
    this.ownership,
    this.status,
    required this.createdAt,
    required this.updatedAt,
  });

  @override
  final String id;
  final String name;
  final String code;
  final String? areaId;
  final String? type;
  final String? sector;
  final String? ownership;
  final String? status;
  final String createdAt;
  final String updatedAt;

  @override
  String get version => updatedAt;

  factory Institution.fromJson(Map<String, dynamic> json) {
    return Institution(
      id: json['id'] as String,
      name: json['name'] as String,
      code: json['code'] as String,
      areaId: json['areaId'] as String?,
      type: json['type'] as String?,
      sector: json['sector'] as String?,
      ownership: json['ownership'] as String?,
      status: json['status'] as String?,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }
}
