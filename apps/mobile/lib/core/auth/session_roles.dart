import 'dart:convert';

/// Role-based UI gating for the mobile shell (PRC-M040).
///
/// The server remains the authority; this only decides which routes and
/// tiles a session sees. Roles come from the access token's `roles` claim
/// (`[{roleId, roleName, ...}]`, see backend token-service). Unknown or
/// missing roles fail closed: staff routes stay hidden.

/// Portal-only roles, mirroring the backend PORTAL_ONLY_ROLES sets.
const Set<String> kPortalRoles = <String>{'parent', 'guardian', 'student'};

/// Route prefixes that need a staff (non-portal) role.
const List<String> kStaffRoutePrefixes = <String>[
  '/attendance',
  '/students',
  '/institutions',
  '/reports',
];

/// Lower-cased role ids/names from a JWT access token; empty when the token
/// is absent, opaque or malformed.
List<String> rolesFromAccessToken(String? token) {
  if (token == null) return const <String>[];
  final List<String> parts = token.split('.');
  if (parts.length != 3) return const <String>[];
  try {
    final Object? claims = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    final Object? raw = claims is Map<String, dynamic> ? claims['roles'] : null;
    if (raw is! List) return const <String>[];
    final Set<String> out = <String>{};
    for (final Object? role in raw) {
      if (role is String) {
        out.add(role.trim().toLowerCase());
      } else if (role is Map) {
        for (final String key in const <String>['roleId', 'roleName']) {
          final Object? v = role[key];
          if (v is String && v.trim().isNotEmpty) {
            out.add(v.trim().toLowerCase());
          }
        }
      }
    }
    out.remove('');
    return out.toList(growable: false);
  } catch (_) {
    return const <String>[];
  }
}

/// True when the session holds at least one non-portal role.
bool hasStaffRole(List<String> roles) =>
    roles.any((String r) => !kPortalRoles.contains(r));

/// True when every role is a portal role (parent/guardian/student).
bool isPortalOnly(List<String> roles) =>
    roles.isNotEmpty && roles.every(kPortalRoles.contains);

/// Whether [location] is a staff-only route.
bool isStaffRoute(String location) => kStaffRoutePrefixes.any(
  (String p) => location == p || location.startsWith('$p/'),
);

/// Human label for the profile screen.
String roleLabel(List<String> roles) {
  if (roles.isEmpty) return '';
  final List<String> pretty = roles
      .where((String r) => !RegExp(r'^[0-9a-f-]{16,}$').hasMatch(r))
      .map(
        (String r) => r
            .split(RegExp(r'[_\s-]+'))
            .where((String w) => w.isNotEmpty)
            .map((String w) => '${w[0].toUpperCase()}${w.substring(1)}')
            .join(' '),
      )
      .toSet()
      .toList();
  return pretty.join(', ');
}
