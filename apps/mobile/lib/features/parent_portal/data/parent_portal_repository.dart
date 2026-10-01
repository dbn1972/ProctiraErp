import 'package:dio/dio.dart';

import 'parent_portal_models.dart';

/// Failure talking to the parent portal. Message is safe to show in the UI.
class ParentPortalException implements Exception {
  const ParentPortalException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Parent-portal reads for the signed-in guardian.
///
/// Tenant comes from the session token (and the shared Dio interceptor).
/// These methods do not accept a tenant id.
abstract class ParentPortalRepository {
  Future<List<LinkedChild>> listChildren();

  Future<List<ParentMessageThread>> listThreads({required String studentId});

  Future<List<ParentConsent>> listConsents({required String studentId});

  Future<List<ParentInvoice>> listInvoices({required String studentId});
}

class DioParentPortalRepository implements ParentPortalRepository {
  DioParentPortalRepository({required Dio dio}) : _dio = dio;

  final Dio _dio;

  static const String _prefix = '/api/v1/parent-portal';

  @override
  Future<List<LinkedChild>> listChildren() async {
    final List<Map<String, dynamic>> rows = await _getList('$_prefix/children');
    final List<LinkedChild> links = rows
        .map(_parseLink)
        .toList(growable: false);
    final List<LinkedChild> enriched = await Future.wait(
      links.map(_enrichChild),
    );
    return enriched;
  }

  @override
  Future<List<ParentMessageThread>> listThreads({
    required String studentId,
  }) async {
    final String id = _requireStudentId(studentId);
    final List<Map<String, dynamic>> rows = await _getList(
      '$_prefix/messages/threads',
    );
    return rows
        .map(_parseThread)
        .where((ParentMessageThread thread) => thread.studentId == id)
        .toList(growable: false);
  }

  @override
  Future<List<ParentConsent>> listConsents({required String studentId}) async {
    final String id = _requireStudentId(studentId);
    final List<Map<String, dynamic>> rows = await _getList('$_prefix/consents');
    return rows
        .map(_parseConsent)
        .where((ParentConsent consent) => consent.studentId == id)
        .toList(growable: false);
  }

  @override
  Future<List<ParentInvoice>> listInvoices({required String studentId}) async {
    final String id = _requireStudentId(studentId);
    final List<Map<String, dynamic>> rows = await _getList(
      '$_prefix/fees/invoices',
    );
    return rows
        .map(_parseInvoice)
        .where((ParentInvoice invoice) => invoice.studentId == id)
        .toList(growable: false);
  }

  Future<List<Map<String, dynamic>>> _getList(String path) async {
    final Object? body = await _get(path);
    if (body is! Map) {
      throw const ParentPortalException('Unexpected parent portal response');
    }
    final Object? data = body['data'];
    if (data is! List) {
      throw const ParentPortalException('Unexpected parent portal response');
    }
    return data
        .whereType<Map>()
        .map((Map<dynamic, dynamic> row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
  }

  Future<Object?> _get(String path) async {
    try {
      final Response<dynamic> response = await _dio.get<dynamic>(path);
      return response.data;
    } on DioException catch (error) {
      throw ParentPortalException(
        _messageFrom(error),
        statusCode: error.response?.statusCode,
      );
    }
  }

  Future<LinkedChild> _enrichChild(LinkedChild child) async {
    String? name = child.givenName;
    String? className = child.className;
    if (name == null || name.trim().isEmpty) {
      name = await _lookupStudentName(child.studentId);
    }
    if (className == null || className.trim().isEmpty) {
      className = await _lookupClassName(child.studentId);
    }
    if (name == child.givenName && className == child.className) {
      return child;
    }
    return child.copyWith(givenName: name, className: className);
  }

  Future<String?> _lookupStudentName(String studentId) async {
    try {
      final Response<dynamic> response = await _dio.get<dynamic>(
        '/api/v1/students/$studentId',
      );
      final Map<String, dynamic>? student = _unwrapObject(response.data);
      if (student == null) {
        return null;
      }
      final String? direct =
          _string(student['studentName']) ??
          _string(student['displayName']) ??
          _string(student['name']);
      if (direct != null) {
        return direct;
      }
      final String first = _string(student['firstName']) ?? '';
      final String last = _string(student['lastName']) ?? '';
      final String joined = '$first $last'.trim();
      return joined.isEmpty ? null : joined;
    } on DioException {
      return null;
    }
  }

  Future<String?> _lookupClassName(String studentId) async {
    try {
      final Response<dynamic> response = await _dio.get<dynamic>(
        '$_prefix/children/$studentId/timetable',
      );
      final Object? body = response.data;
      if (body is! Map) {
        return null;
      }
      final Object? data = body['data'];
      if (data is! List) {
        return null;
      }
      for (final Object? slot in data) {
        if (slot is! Map) {
          continue;
        }
        final String? section =
            _string(slot['sectionName']) ??
            _string(slot['className']) ??
            _string(slot['class']);
        if (section != null) {
          return section;
        }
      }
      return null;
    } on DioException {
      return null;
    }
  }

  LinkedChild _parseLink(Map<String, dynamic> json) {
    final String? studentId = _string(json['studentId']);
    final String? linkId = _string(json['id']);
    if (studentId == null || linkId == null) {
      throw const ParentPortalException('Child link is missing an id');
    }
    return LinkedChild(
      linkId: linkId,
      studentId: studentId,
      relationship: _string(json['relationship']) ?? 'guardian',
      status: _string(json['status']) ?? 'active',
      givenName: _nameFromLink(json),
      className: _classFromLink(json),
    );
  }

  ParentMessageThread _parseThread(Map<String, dynamic> json) {
    return ParentMessageThread(
      id: _string(json['id']) ?? '',
      studentId: _string(json['studentId']) ?? '',
      subject: _string(json['subject']) ?? 'Message',
      status: _string(json['status']) ?? '',
    );
  }

  ParentConsent _parseConsent(Map<String, dynamic> json) {
    return ParentConsent(
      id: _string(json['id']) ?? '',
      studentId: _string(json['studentId']) ?? '',
      title: _string(json['title']) ?? 'Consent',
      status: _string(json['status']) ?? '',
      consentType: _string(json['consentType']) ?? '',
    );
  }

  ParentInvoice _parseInvoice(Map<String, dynamic> json) {
    final Object? cents = json['amountCents'];
    return ParentInvoice(
      id: _string(json['id']) ?? '',
      studentId: _string(json['studentId']) ?? '',
      title: _string(json['title']) ?? 'Invoice',
      status: _string(json['status']) ?? '',
      amountCents: cents is num && cents.isFinite ? cents.round() : null,
      currency: _string(json['currency']) ?? '',
    );
  }

  String _requireStudentId(String studentId) {
    final String id = studentId.trim();
    if (id.isEmpty) {
      throw const ParentPortalException('Select a linked child first');
    }
    return id;
  }

  String? _nameFromLink(Map<String, dynamic> json) {
    final Object? student = json['student'];
    if (student is Map) {
      final Map<String, dynamic> row = Map<String, dynamic>.from(student);
      final String? nested =
          _string(row['name']) ??
          _string(row['displayName']) ??
          _joinName(row['firstName'], row['lastName']);
      if (nested != null) {
        return nested;
      }
    }
    return _string(json['studentName']) ??
        _string(json['displayName']) ??
        _string(json['name']) ??
        _joinName(json['firstName'], json['lastName']);
  }

  String? _classFromLink(Map<String, dynamic> json) {
    return _string(json['className']) ??
        _string(json['class']) ??
        _string(json['grade']) ??
        _string(json['sectionName']);
  }

  String? _joinName(Object? first, Object? last) {
    final String joined = '${_string(first) ?? ''} ${_string(last) ?? ''}'
        .trim();
    return joined.isEmpty ? null : joined;
  }

  Map<String, dynamic>? _unwrapObject(Object? body) {
    if (body is! Map) {
      return null;
    }
    final Map<String, dynamic> map = Map<String, dynamic>.from(body);
    final Object? data = map['data'];
    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }
    return map;
  }

  String? _string(Object? value) {
    if (value is! String) {
      return null;
    }
    final String trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  String _messageFrom(DioException error) {
    final Object? data = error.response?.data;
    if (data is Map && data['message'] is String) {
      final String message = (data['message'] as String).trim();
      if (message.isNotEmpty) {
        return message;
      }
    }
    return 'Could not reach the parent portal. Try again.';
  }
}
