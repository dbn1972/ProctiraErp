import 'package:dio/dio.dart';

class WorkflowDefinition {
  const WorkflowDefinition({
    required this.id,
    required this.name,
    required this.entityType,
    required this.updatedAt,
    this.description,
  });

  final String id;
  final String name;
  final String entityType;
  final String updatedAt;
  final String? description;

  factory WorkflowDefinition.fromJson(Map<String, dynamic> json) {
    return WorkflowDefinition(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      entityType: (json['entityType'] as String?) ??
          (json['module'] as String?) ??
          '',
      updatedAt: json['updatedAt'] as String? ?? '',
      description: json['description'] as String?,
    );
  }
}

class WorkflowInstance {
  const WorkflowInstance({
    required this.id,
    required this.definitionId,
    required this.entityType,
    required this.entityId,
    required this.currentStateId,
    required this.status,
    required this.createdAt,
    this.definitionName,
  });

  final String id;
  final String definitionId;
  final String entityType;
  final String entityId;
  final String currentStateId;
  final String status;
  final String createdAt;
  final String? definitionName;

  factory WorkflowInstance.fromJson(Map<String, dynamic> json) {
    return WorkflowInstance(
      id: json['id'] as String? ?? '',
      definitionId: (json['workflowDefinitionId'] as String?) ??
          (json['definitionId'] as String?) ??
          '',
      entityType: (json['entityType'] as String?) ??
          (json['subjectType'] as String?) ??
          '',
      entityId:
          (json['entityId'] as String?) ?? (json['subjectId'] as String?) ?? '',
      currentStateId: (json['currentStateId'] as String?) ??
          (json['currentStep'] as String?) ??
          '',
      status: json['status'] as String? ?? 'ACTIVE',
      createdAt: (json['createdAt'] as String?) ??
          (json['initiatedAt'] as String?) ??
          '',
      definitionName: json['definitionName'] as String?,
    );
  }
}

class WorkflowApproval {
  const WorkflowApproval({
    required this.id,
    required this.instanceId,
    required this.definitionName,
    required this.subjectType,
    required this.subjectId,
    required this.stepName,
    required this.requestedAt,
    required this.requestedBy,
  });

  final String id;
  final String instanceId;
  final String definitionName;
  final String subjectType;
  final String subjectId;
  final String stepName;
  final String requestedAt;
  final String requestedBy;

  factory WorkflowApproval.fromJson(Map<String, dynamic> json) {
    return WorkflowApproval(
      id: json['id'] as String? ?? '',
      instanceId: json['instanceId'] as String? ?? json['id'] as String? ?? '',
      definitionName: json['definitionName'] as String? ?? '',
      subjectType: json['subjectType'] as String? ?? '',
      subjectId: json['subjectId'] as String? ?? '',
      stepName: json['stepName'] as String? ?? '',
      requestedAt: json['requestedAt'] as String? ?? '',
      requestedBy: json['requestedBy'] as String? ?? '',
    );
  }
}

/// Dio client for `/api/v1/workflows/*`.
class WorkflowRepository {
  WorkflowRepository({required Dio dio}) : _dio = dio;

  final Dio _dio;

  Future<List<WorkflowDefinition>> listDefinitions() async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/workflows',
        queryParameters: const <String, dynamic>{'pageSize': 100},
      );
      return _unwrapList(response.data)
          .map(WorkflowDefinition.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <WorkflowDefinition>[];
    }
  }

  Future<List<WorkflowInstance>> listInstances({String? status}) async {
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/workflows/instances',
        queryParameters: <String, dynamic>{
          'pageSize': 100,
          'status': ?status,
        },
      );
      return _unwrapList(response.data)
          .map(WorkflowInstance.fromJson)
          .toList(growable: false);
    } on DioException {
      return const <WorkflowInstance>[];
    }
  }

  Future<List<WorkflowApproval>> listPendingApprovals() async {
    try {
      final Response<dynamic> dedicated = await _dio.get(
        '/api/v1/workflows/approvals/pending',
      );
      final List<WorkflowApproval> list = _unwrapList(dedicated.data)
          .map(WorkflowApproval.fromJson)
          .toList(growable: false);
      if (list.isNotEmpty || dedicated.statusCode == 200) {
        return list;
      }
    } on DioException {
      // Fall through to instances.
    }

    final List<WorkflowInstance> active =
        await listInstances(status: 'ACTIVE');
    return active
        .map(
          (WorkflowInstance i) => WorkflowApproval(
            id: i.id,
            instanceId: i.id,
            definitionName: i.definitionName ?? i.definitionId,
            subjectType: i.entityType,
            subjectId: i.entityId,
            stepName: i.currentStateId,
            requestedAt: i.createdAt,
            requestedBy: '—',
          ),
        )
        .toList(growable: false);
  }

  Future<void> transition({
    required String instanceId,
    required String action,
    required String actorId,
    String? comments,
  }) async {
    await _dio.post(
      '/api/v1/workflows/instances/$instanceId/transition',
      data: <String, dynamic>{
        'action': action,
        'actorId': actorId,
        'comments': ?(comments != null && comments.isNotEmpty ? comments : null),
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
