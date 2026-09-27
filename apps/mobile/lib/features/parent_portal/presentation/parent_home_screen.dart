import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../../../core/student/selected_student_store.dart';
import '../data/parent_portal_models.dart';
import '../data/parent_portal_repository.dart';

/// First-class parent portal home (separate from staff-leaning HomeScreen).
///
/// Staff MobileShell / HomeScreen quick actions remain teacher/clerk oriented.
/// Guardians land here via `/parent` routes.
class ParentHomeScreen extends StatefulWidget {
  const ParentHomeScreen({super.key, this.repository});

  /// Test hook. Production resolves [ParentPortalRepository] from the tree.
  final ParentPortalRepository? repository;

  @override
  State<ParentHomeScreen> createState() => _ParentHomeScreenState();
}

class _ParentHomeScreenState extends State<ParentHomeScreen> {
  bool _loading = true;
  String? _error;
  List<LinkedChild> _children = const <LinkedChild>[];
  String? _selectedStudentId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _load();
      }
    });
  }

  ParentPortalRepository _repository() {
    return widget.repository ?? context.read<ParentPortalRepository>();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<LinkedChild> children = await _repository().listChildren();
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _children = children;
        _selectedStudentId = _pickSelection(children);
      });
      final LinkedChild? selected = _selectedChild;
      if (selected != null) {
        _remember(selected);
      }
    } on ParentPortalException catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _error = error.message;
        _children = const <LinkedChild>[];
        _selectedStudentId = null;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _error = 'Could not reach the parent portal. Try again.';
        _children = const <LinkedChild>[];
        _selectedStudentId = null;
      });
    }
  }

  String? _pickSelection(List<LinkedChild> children) {
    if (children.isEmpty) {
      return null;
    }
    final SelectedStudentStore? store = _store();
    final String? remembered = store?.studentId;
    if (remembered != null &&
        children.any((LinkedChild child) => child.studentId == remembered)) {
      return remembered;
    }
    if (_selectedStudentId != null &&
        children.any(
          (LinkedChild child) => child.studentId == _selectedStudentId,
        )) {
      return _selectedStudentId;
    }
    return children.first.studentId;
  }

  LinkedChild? get _selectedChild {
    for (final LinkedChild child in _children) {
      if (child.studentId == _selectedStudentId) {
        return child;
      }
    }
    return null;
  }

  SelectedStudentStore? _store() {
    if (getIt.isRegistered<SelectedStudentStore>()) {
      return getIt<SelectedStudentStore>();
    }
    return null;
  }

  void _remember(LinkedChild child) {
    final SelectedStudentStore? store = _store();
    if (store == null) {
      return;
    }
    unawaited(
      store.select(id: child.studentId, displayName: child.nameLabel),
    );
  }

  void _select(LinkedChild child) {
    setState(() => _selectedStudentId = child.studentId);
    _remember(child);
  }

  void _open(String path) {
    final String? studentId = _selectedStudentId;
    if (studentId == null || studentId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select a linked child first')),
      );
      return;
    }
    context.push('$path?studentId=$studentId');
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Parent portal'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text(
            'Your school connection',
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Message the school, respond to consent requests, and pay fees. '
            'Staff attendance and roster tools stay on the main home screen.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 24),
          Text('Child', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          ..._childRegion(),
          if (!_loading && _error == null && _children.isNotEmpty) ...<Widget>[
            const SizedBox(height: 24),
            _ParentTile(
              icon: Icons.chat_bubble_outline,
              title: 'Messages',
              subtitle: 'Two-way threads with the school',
              onTap: () => _open('/parent/messages'),
            ),
            _ParentTile(
              icon: Icons.verified_user_outlined,
              title: 'Consents',
              subtitle: 'Photo, medical, trip approvals',
              onTap: () => _open('/parent/consents'),
            ),
            _ParentTile(
              icon: Icons.payments_outlined,
              title: 'Fees',
              subtitle: 'Invoices and sandbox pay',
              onTap: () => _open('/parent/fees'),
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _childRegion() {
    if (_loading) {
      return <Widget>[
        Semantics(
          label: 'Loading linked children',
          child: const SizedBox(
            height: 88,
            child: Center(child: CircularProgressIndicator()),
          ),
        ),
      ];
    }
    if (_error != null) {
      return <Widget>[
        Text(_error!, textAlign: TextAlign.start),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: Semantics(
            button: true,
            label: 'Retry loading children',
            child: FilledButton(
              style: FilledButton.styleFrom(
                minimumSize: const Size(44, 44),
              ),
              onPressed: _load,
              child: const Text('Retry'),
            ),
          ),
        ),
      ];
    }
    if (_children.isEmpty) {
      return const <Widget>[
        Card(
          child: ListTile(
            minTileHeight: 48,
            leading: Icon(Icons.child_care_outlined),
            title: Text('No children linked yet'),
            subtitle: Text(
              'Ask your school to link a child before messages, consents, or fees.',
            ),
          ),
        ),
      ];
    }
    return <Widget>[
      Semantics(
        label: 'Linked children',
        explicitChildNodes: true,
        child: Column(
          children: <Widget>[
            for (final LinkedChild child in _children)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _ChildCard(
                  child: child,
                  selected: child.studentId == _selectedStudentId,
                  onTap: () => _select(child),
                ),
              ),
          ],
        ),
      ),
    ];
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({
    required this.child,
    required this.selected,
    required this.onTap,
  });

  final LinkedChild child;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: '${child.nameLabel}, class ${child.classLabel}',
      child: Card(
        key: ValueKey<String>('child-${child.studentId}'),
        margin: EdgeInsets.zero,
        child: ListTile(
          minTileHeight: 48,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          leading: const Icon(Icons.child_care_outlined),
          title: Text(child.nameLabel),
          subtitle: Text(child.classLabel),
          trailing: selected
              ? const Icon(Icons.check_circle, key: Key('selected-child'))
              : const Icon(Icons.circle_outlined),
          selected: selected,
          onTap: onTap,
        ),
      ),
    );
  }
}

class _ParentTile extends StatelessWidget {
  const _ParentTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Semantics(
        button: true,
        label: title,
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          minTileHeight: 48,
          leading: Icon(icon),
          title: Text(title),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
      ),
    );
  }
}
