import 'package:meta/meta.dart';

import 'versioned.dart';

/// DTO mirroring `StudentResponseSchema` on the backend (only the fields the
/// mobile app currently uses).
@immutable
class Student implements Versioned {
  const Student({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.middleName,
    this.nationalId,
    this.dateOfBirth,
    this.gender,
    this.institutionId,
    required this.createdAt,
    required this.updatedAt,
  });

  @override
  final String id;
  final String firstName;
  final String lastName;
  final String? middleName;
  final String? nationalId;
  final String? dateOfBirth;
  final String? gender;
  final String? institutionId;
  final String createdAt;
  final String updatedAt;

  @override
  String get version => updatedAt;

  String get fullName {
    final String middle = middleName == null || middleName!.isEmpty
        ? ''
        : ' ${middleName!} ';
    return '$firstName$middle $lastName'.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  factory Student.fromJson(Map<String, dynamic> json) {
    return Student(
      id: json['id'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      middleName: json['middleName'] as String?,
      nationalId: json['nationalId'] as String?,
      dateOfBirth: json['dateOfBirth'] as String?,
      gender: json['gender'] as String?,
      institutionId: json['institutionId'] as String?,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }
}
