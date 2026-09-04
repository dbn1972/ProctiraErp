import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/di/injector.dart';
import '../data/workflow_repository.dart';

/// Workflow definitions list with links to instances + approvals.
class WorkflowsListScreen extends StatefulWidget {
  const WorkflowsListScreen({super.key});

  @override
  State<WorkflowsListScreen> createState() => _WorkflowsListScreenState();
}

class _WorkflowsListScreenState extends State<WorkflowsListScreen> {
  late Future<List<WorkflowDefinition>> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<WorkflowRepository>().listDefinitions();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Workflows'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Instances',
            icon: const Icon(Icons.account_tree_outlined),
            onPressed: () => context.push('/workflows/instances'),
          ),
          IconButton(
            tooltip: 'Approvals',
            icon: const Icon(Icons.fact_check_outlined),
            onPressed: () => context.push('/workflows/approvals'),
          ),
        ],
      ),
      body: FutureBuilder<List<WorkflowDefinition>>(
        future: _future,
        builder: (BuildContext context,
            AsyncSnapshot<List<WorkflowDefinition>> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final List<WorkflowDefinition> items =
              snap.data ?? const <WorkflowDefinition>[];
          if (items.isEmpty) {
            return const Center(child: Text('No workflow definitions'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (BuildContext context, int index) {
              final WorkflowDefinition d = items[index];
              return Card(
                child: ListTile(
                  title: Text(d.name),
                  subtitle: Text(
                    <String>[
                      d.entityType,
                      if (d.description != null && d.description!.isNotEmpty)
                        d.description!,
                    ].join(' · '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class WorkflowInstancesScreen extends StatefulWidget {
  const WorkflowInstancesScreen({super.key});

  @override
  State<WorkflowInstancesScreen> createState() =>
      _WorkflowInstancesScreenState();
}

class _WorkflowInstancesScreenState extends State<WorkflowInstancesScreen> {
  late Future<List<WorkflowInstance>> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<WorkflowRepository>().listInstances();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Instances')),
      body: FutureBuilder<List<WorkflowInstance>>(
        future: _future,
        builder: (BuildContext context,
            AsyncSnapshot<List<WorkflowInstance>> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final List<WorkflowInstance> items =
              snap.data ?? const <WorkflowInstance>[];
          if (items.isEmpty) {
            return const Center(child: Text('No workflow instances'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (BuildContext context, int index) {
              final WorkflowInstance i = items[index];
              return Card(
                child: ListTile(
                  title: Text(i.definitionName ?? i.definitionId),
                  subtitle: Text(
                    '${i.entityType} ${i.entityId} · ${i.currentStateId}',
                  ),
                  trailing: Text(
                    i.status,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class WorkflowApprovalsScreen extends StatefulWidget {
  const WorkflowApprovalsScreen({super.key});

  @override
  State<WorkflowApprovalsScreen> createState() =>
      _WorkflowApprovalsScreenState();
}

class _WorkflowApprovalsScreenState extends State<WorkflowApprovalsScreen> {
  late Future<List<WorkflowApproval>> _future;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    setState(() {
      _future = getIt<WorkflowRepository>().listPendingApprovals();
    });
  }

  Future<void> _transition(WorkflowApproval approval, String action) async {
    setState(() => _busy = true);
    try {
      final String actorId =
          context.read<AuthBloc>().state.userId ?? 'mobile-user';
      await getIt<WorkflowRepository>().transition(
        instanceId: approval.instanceId,
        action: action,
        actorId: actorId,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${action[0].toUpperCase()}${action.substring(1)} submitted')),
      );
      _reload();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not $action: $error')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My approvals')),
      body: FutureBuilder<List<WorkflowApproval>>(
        future: _future,
        builder: (BuildContext context,
            AsyncSnapshot<List<WorkflowApproval>> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final List<WorkflowApproval> items =
              snap.data ?? const <WorkflowApproval>[];
          if (items.isEmpty) {
            return const Center(child: Text("You're all caught up"));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (BuildContext context, int index) {
              final WorkflowApproval a = items[index];
              return Card(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        a.definitionName,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${a.subjectType} ${a.subjectId} · ${a.stepName}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Requested by ${a.requestedBy} · ${a.requestedAt}',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurfaceVariant,
                            ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: OutlinedButton(
                              onPressed: _busy
                                  ? null
                                  : () => _transition(a, 'reject'),
                              child: const Text('Reject'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: FilledButton(
                              onPressed: _busy
                                  ? null
                                  : () => _transition(a, 'approve'),
                              child: const Text('Approve'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
