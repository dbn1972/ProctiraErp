'use strict';

/**
 * PRC-L581: forbid unscoped `PgDocumentCollection` call sites.
 *
 * `control_plane_documents` holds tenant-owned and platform-owned rows. The
 * read/delete methods (`get`, `delete`, `all`, `count`) already require a
 * `DocumentScope` at compile time, but the write and query helpers take the
 * owning tenant as an optional trailing argument:
 *
 *   put(id, data, tenantId = null)            insertIfAbsent(id, data, tenantId = null)
 *   where(criteria, tenantId?)                first(criteria, tenantId?)
 *
 * Omitting it silently writes a platform-owned row or reads across every
 * tenant under the platform-admin bind. This rule makes the omission a lint
 * error: every call must pass the owning tenant, or an explicit `null` when
 * a platform-owned row / cross-tenant platform read is really intended.
 *
 * Receivers are identified statically within the file: identifiers or
 * `this.<field>` members that are assigned `new PgDocumentCollection(...)` or
 * declared with a `PgDocumentCollection<...>` type annotation (class field,
 * constructor parameter property, variable).
 */

const CLASS_NAME = 'PgDocumentCollection';

/** Minimum argument count per method: the scope/tenant argument must be present. */
const MIN_ARGS = {
  put: 3,
  insertIfAbsent: 3,
  where: 2,
  first: 2,
  get: 2,
  delete: 2,
  all: 1,
  count: 1,
};

function isCollectionType(typeAnnotation) {
  const t = typeAnnotation && typeAnnotation.typeAnnotation;
  return Boolean(
    t &&
    t.type === 'TSTypeReference' &&
    t.typeName &&
    t.typeName.type === 'Identifier' &&
    t.typeName.name === CLASS_NAME,
  );
}

function isNewCollection(node) {
  return Boolean(
    node &&
    node.type === 'NewExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === CLASS_NAME,
  );
}

function keyName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'PrivateIdentifier') return `#${node.name}`;
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every PgDocumentCollection put/insertIfAbsent/where/first call to state its tenant scope (PRC-L581)',
      recommended: true,
    },
    schema: [],
    messages: {
      unscoped:
        'PgDocumentCollection.{{method}}() must state its scope: pass the owning tenantId, or an explicit `null` for a platform-owned row (PRC-L581).',
    },
  },

  create(context) {
    /** Names bound to a collection: plain identifiers and `this.<field>` members. */
    const identifiers = new Set();
    const members = new Set();
    /** Calls seen before their receiver was known (class fields may be declared later). */
    const pending = [];

    function receiverKind(object) {
      if (object.type === 'Identifier') return { kind: 'id', name: object.name };
      if (object.type === 'MemberExpression' && object.object.type === 'ThisExpression') {
        const name = keyName(object.property);
        if (name && !object.computed) return { kind: 'member', name };
      }
      return null;
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') return;
        if (isNewCollection(node.init) || isCollectionType(node.id.typeAnnotation)) {
          identifiers.add(node.id.name);
        }
      },
      AssignmentExpression(node) {
        if (!isNewCollection(node.right)) return;
        const r = receiverKind(node.left);
        if (r && r.kind === 'member') members.add(r.name);
        if (r && r.kind === 'id') identifiers.add(r.name);
      },
      PropertyDefinition(node) {
        const name = keyName(node.key);
        if (!name) return;
        if (isNewCollection(node.value) || isCollectionType(node.typeAnnotation)) {
          members.add(name);
        }
      },
      TSParameterProperty(node) {
        const param = node.parameter;
        if (param && param.type === 'Identifier' && isCollectionType(param.typeAnnotation)) {
          members.add(param.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        const method = keyName(callee.property);
        if (!method || !Object.prototype.hasOwnProperty.call(MIN_ARGS, method)) return;
        const r = receiverKind(callee.object);
        if (!r) return;
        pending.push({ node, method, receiver: r });
      },
      'Program:exit'() {
        for (const { node, method, receiver } of pending) {
          const known =
            receiver.kind === 'id' ? identifiers.has(receiver.name) : members.has(receiver.name);
          if (!known) continue;
          if (node.arguments.length >= MIN_ARGS[method]) continue;
          if (node.arguments.some((a) => a.type === 'SpreadElement')) continue;
          context.report({ node, messageId: 'unscoped', data: { method } });
        }
      },
    };
  },
};
