import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/storage/cache_crypto.dart';
import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Health measurement record.
class HealthMeasurement {
  const HealthMeasurement({
    required this.id,
    required this.type,
    required this.value,
    required this.unit,
    required this.recordedAt,
    this.notes,
  });

  final String id;
  final String type; // height, weight, bmi, blood_pressure, etc.
  final double value;
  final String unit;
  final String recordedAt;
  final String? notes;

  factory HealthMeasurement.fromJson(Map<String, dynamic> json) {
    return HealthMeasurement(
      id: json['id'] as String,
      type: json['type'] as String,
      value: (json['value'] as num).toDouble(),
      unit: json['unit'] as String,
      recordedAt: json['recordedAt'] as String,
      notes: json['notes'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'type': type,
        'value': value,
        'unit': unit,
        'recordedAt': recordedAt,
        'notes': notes,
      };
}

/// Vaccination record.
class VaccinationRecord {
  const VaccinationRecord({
    required this.id,
    required this.vaccineName,
    required this.doseNumber,
    required this.administeredAt,
    this.batchNumber,
    this.administeredBy,
    this.nextDueDate,
  });

  final String id;
  final String vaccineName;
  final int doseNumber;
  final String administeredAt;
  final String? batchNumber;
  final String? administeredBy;
  final String? nextDueDate;

  factory VaccinationRecord.fromJson(Map<String, dynamic> json) {
    return VaccinationRecord(
      id: json['id'] as String,
      vaccineName: json['vaccineName'] as String,
      doseNumber: json['doseNumber'] as int,
      administeredAt: json['administeredAt'] as String,
      batchNumber: json['batchNumber'] as String?,
      administeredBy: json['administeredBy'] as String?,
      nextDueDate: json['nextDueDate'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'vaccineName': vaccineName,
        'doseNumber': doseNumber,
        'administeredAt': administeredAt,
        'batchNumber': batchNumber,
        'administeredBy': administeredBy,
        'nextDueDate': nextDueDate,
      };
}

/// Health condition record.
class HealthCondition {
  const HealthCondition({
    required this.id,
    required this.name,
    required this.severity,
    this.diagnosedAt,
    this.notes,
    this.isActive = true,
  });

  final String id;
  final String name;
  final String severity; // mild, moderate, severe
  final String? diagnosedAt;
  final String? notes;
  final bool isActive;

  factory HealthCondition.fromJson(Map<String, dynamic> json) {
    return HealthCondition(
      id: json['id'] as String,
      name: json['name'] as String,
      severity: json['severity'] as String,
      diagnosedAt: json['diagnosedAt'] as String?,
      notes: json['notes'] as String?,
      isActive: json['isActive'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'name': name,
        'severity': severity,
        'diagnosedAt': diagnosedAt,
        'notes': notes,
        'isActive': isActive,
      };
}

/// Aggregated health records for a student.
class HealthRecords {
  const HealthRecords({
    this.measurements = const <HealthMeasurement>[],
    this.vaccinations = const <VaccinationRecord>[],
    this.conditions = const <HealthCondition>[],
  });

  final List<HealthMeasurement> measurements;
  final List<VaccinationRecord> vaccinations;
  final List<HealthCondition> conditions;

  bool get isEmpty =>
      measurements.isEmpty && vaccinations.isEmpty && conditions.isEmpty;
}

/// Read-only repository for student health records.
class HealthRepository {
  HealthRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required Dio dio,
    required CacheCrypto cacheCrypto,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _dio = dio,
        _cacheCrypto = cacheCrypto;

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final Dio _dio;
  final CacheCrypto _cacheCrypto;

  /// Fetch all health records for a student.
  Future<HealthRecords> getRecords({required String studentId}) async {
    final String tenantId = _requireTenantId();

    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/health/records',
        queryParameters: <String, dynamic>{'studentId': studentId},
      );

      final Map<String, dynamic> data =
          response.data as Map<String, dynamic>;

      final List<HealthMeasurement> measurements =
          (data['measurements'] as List<dynamic>?)
                  ?.map((dynamic e) =>
                      HealthMeasurement.fromJson(e as Map<String, dynamic>))
                  .toList(growable: false) ??
              const <HealthMeasurement>[];

      final List<VaccinationRecord> vaccinations =
          (data['vaccinations'] as List<dynamic>?)
                  ?.map((dynamic e) =>
                      VaccinationRecord.fromJson(e as Map<String, dynamic>))
                  .toList(growable: false) ??
              const <VaccinationRecord>[];

      final List<HealthCondition> conditions =
          (data['conditions'] as List<dynamic>?)
                  ?.map((dynamic e) =>
                      HealthCondition.fromJson(e as Map<String, dynamic>))
                  .toList(growable: false) ??
              const <HealthCondition>[];

      final HealthRecords records = HealthRecords(
        measurements: measurements,
        vaccinations: vaccinations,
        conditions: conditions,
      );

      await _cacheRecords(tenantId, studentId, records);
      return records;
    } on DioException {
      return _getCachedRecords(tenantId, studentId);
    }
  }

  Future<void> _cacheRecords(
    String tenantId,
    String studentId,
    HealthRecords records,
  ) async {
    final Database db = await _database.database;
    final String payload = jsonEncode(<String, dynamic>{
      'measurements':
          records.measurements.map((HealthMeasurement m) => m.toJson()).toList(),
      'vaccinations':
          records.vaccinations.map((VaccinationRecord v) => v.toJson()).toList(),
      'conditions':
          records.conditions.map((HealthCondition c) => c.toJson()).toList(),
    });

    await db.insert(
      'health_records_cache',
      <String, Object?>{
        'tenant_id': tenantId,
        'student_id': studentId,
        'payload': await _cacheCrypto.encrypt(payload),
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<HealthRecords> _getCachedRecords(
    String tenantId,
    String studentId,
  ) async {
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'health_records_cache',
      where: 'tenant_id = ? AND student_id = ?',
      whereArgs: <Object>[tenantId, studentId],
      limit: 1,
    );

    if (rows.isEmpty) return const HealthRecords();

    final String payloadRaw =
        await _cacheCrypto.decrypt(rows.first['payload'] as String);
    final Map<String, dynamic> data =
        jsonDecode(payloadRaw) as Map<String, dynamic>;

    return HealthRecords(
      measurements: (data['measurements'] as List<dynamic>?)
              ?.map((dynamic e) =>
                  HealthMeasurement.fromJson(e as Map<String, dynamic>))
              .toList(growable: false) ??
          const <HealthMeasurement>[],
      vaccinations: (data['vaccinations'] as List<dynamic>?)
              ?.map((dynamic e) =>
                  VaccinationRecord.fromJson(e as Map<String, dynamic>))
              .toList(growable: false) ??
          const <VaccinationRecord>[],
      conditions: (data['conditions'] as List<dynamic>?)
              ?.map((dynamic e) =>
                  HealthCondition.fromJson(e as Map<String, dynamic>))
              .toList(growable: false) ??
          const <HealthCondition>[],
    );
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError('No active tenant for health repository.');
    }
    return tenantId;
  }
}
