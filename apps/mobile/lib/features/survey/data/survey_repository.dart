import 'package:dio/dio.dart';

class SurveyQuestion {
  const SurveyQuestion({
    required this.label,
    required this.type,
    required this.order,
    this.id,
    this.required = false,
    this.options = const <({String label, String value})>[],
  });

  final String? id;
  final String label;
  final String type;
  final int order;
  final bool required;
  final List<({String label, String value})> options;

  factory SurveyQuestion.fromJson(Map<String, dynamic> json) {
    final List<dynamic>? rawOptions = json['options'] as List<dynamic>?;
    return SurveyQuestion(
      id: json['id'] as String?,
      label: json['label'] as String? ?? '',
      type: json['type'] as String? ?? 'text',
      order: json['order'] as int? ?? 0,
      required: json['required'] as bool? ?? false,
      options: rawOptions
              ?.whereType<Map>()
              .map(
                (Map e) => (
                  label: e['label'] as String? ?? '',
                  value: e['value'] as String? ?? '',
                ),
              )
              .toList(growable: false) ??
          const <({String label, String value})>[],
    );
  }
}

class Survey {
  const Survey({
    required this.id,
    required this.name,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.description,
    this.startDate,
    this.endDate,
    this.questions = const <SurveyQuestion>[],
  });

  final String id;
  final String name;
  final String status;
  final String createdAt;
  final String updatedAt;
  final String? description;
  final String? startDate;
  final String? endDate;
  final List<SurveyQuestion> questions;

  factory Survey.fromJson(Map<String, dynamic> json) {
    final List<dynamic>? rawQuestions = json['questions'] as List<dynamic>?;
    return Survey(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? 'draft',
      createdAt: json['createdAt'] as String? ?? '',
      updatedAt: json['updatedAt'] as String? ?? '',
      description: json['description'] as String?,
      startDate: json['startDate'] as String?,
      endDate: json['endDate'] as String?,
      questions: rawQuestions
              ?.whereType<Map>()
              .map(
                (Map e) =>
                    SurveyQuestion.fromJson(Map<String, dynamic>.from(e)),
              )
              .toList(growable: false) ??
          const <SurveyQuestion>[],
    );
  }
}

/// Dio client for `/api/v1/surveys`.
class SurveyRepository {
  SurveyRepository({required Dio dio}) : _dio = dio;

  final Dio _dio;

  Future<List<Survey>> listSurveys({String? status}) async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/surveys',
        queryParameters: <String, dynamic>{
          'pageSize': 100,
          'status': ?status,
        },
      );
      return _unwrapList(response.data)
          .map(Survey.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <Survey>[];
    }
  }

  Future<Survey?> getSurvey(String id) async {
    try {
      final Response<dynamic> response = await _dio.get('/api/v1/surveys/$id');
      final Object? raw = response.data;
      if (raw is! Map) return null;
      return Survey.fromJson(Map<String, dynamic>.from(raw));
    } on DioException {
      return null;
    }
  }

  Future<void> submitResponse({
    required String surveyId,
    required String institutionId,
    required List<Map<String, dynamic>> answers,
  }) async {
    await _dio.post(
      '/api/v1/surveys/submit',
      data: <String, dynamic>{
        'surveyId': surveyId,
        'institutionId': institutionId,
        'answers': answers,
      },
    );
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
