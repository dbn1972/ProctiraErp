/**
 * @fileoverview ESLint rule that enforces the platform error envelope on
 * Fastify reply.status(4xx|5xx).send({...}) calls.
 *
 * Charter §6 (API Standards) and §32 (Definition of Done) require every
 * 4xx/5xx response payload to include `code`, `message`, and `statusCode`.
 * Spreads (`...envelope`) and re-thrown errors are exempt because they
 * delegate to the global error handler. A status or payload passed as an
 * identifier bound by a single `const` is resolved to its initializer
 * (PRC-L301); other bindings are presumed compliant.
 *
 * Mirrors the static check in tools/dod-checks/src/checks/error-envelope.mjs
 * so the same violation surfaces both at edit time (here) and at release
 * time (the aggregator).
 */

'use strict';

const REQUIRED_FIELDS = ['code', 'message', 'statusCode'];

/** Returns the numeric status code from a `status(n)` / `code(n)` argument. */
function readStatusArg(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (node.type === 'TemplateLiteral' && node.quasis.length === 1) {
    const n = Number(node.quasis[0].value.cooked);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Returns true when the call expression is `<expr>.status(n).send(...)`. */
function isReplySendCall(node) {
  if (node.type !== 'CallExpression') return false;
  if (node.callee.type !== 'MemberExpression') return false;
  if (node.callee.property.name !== 'send') return false;
  const inner = node.callee.object;
  if (inner.type !== 'CallExpression') return false;
  if (inner.callee.type !== 'MemberExpression') return false;
  const innerName = inner.callee.property.name;
  if (innerName !== 'status' && innerName !== 'code') return false;
  return true;
}

/**
 * Inspect an ObjectExpression and return the list of REQUIRED_FIELDS that
 * are missing. Returns `null` to indicate "presumed compliant" (e.g. spread).
 */
function findMissingFields(objectExpr) {
  if (!objectExpr || objectExpr.type !== 'ObjectExpression') return null;
  const present = new Set();
  for (const prop of objectExpr.properties) {
    if (prop.type === 'SpreadElement') return null;
    if (prop.type !== 'Property') continue;
    const key =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'Literal'
          ? String(prop.key.value)
          : null;
    if (key) present.add(key);
  }
  return REQUIRED_FIELDS.filter((f) => !present.has(f));
}

/**
 * PRC-L301: resolve an Identifier to the `init` of a single `const`
 * declaration in scope. Returns `null` (presumed compliant) for anything
 * else: let/var, parameters, imports, or no binding. With `soleRead`, the
 * binding must have no other reads than `node` so a payload mutated or
 * passed elsewhere after declaration is not judged by its initializer.
 */
function resolveConstInit(context, node, { soleRead = false } = {}) {
  if (!node || node.type !== 'Identifier') return node;
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  let scope = sourceCode.getScope ? sourceCode.getScope(node) : context.getScope();
  let variable = null;
  while (scope && !variable) {
    variable = scope.set.get(node.name) ?? null;
    scope = scope.upper;
  }
  if (!variable || variable.defs.length !== 1) return null;
  const def = variable.defs[0];
  if (def.type !== 'Variable' || def.parent?.kind !== 'const') return null;
  if (def.node.type !== 'VariableDeclarator' || def.node.id.type !== 'Identifier') return null;
  if (!def.node.init) return null;
  if (soleRead) {
    const reads = variable.references.filter((r) => !r.init);
    if (reads.length !== 1 || reads[0].identifier !== node) return null;
  }
  return def.node.init;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the standard {code, message, statusCode} envelope on Fastify 4xx/5xx replies.',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [],
    messages: {
      missingFields:
        'Error response (status {{status}}) is missing envelope field(s): {{missing}}. Use { code, message, statusCode } or AppError.',
      rawError:
        'Avoid `throw new Error(...)` outside catch blocks; use AppError so the global handler renders the envelope.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isReplySendCall(node)) return;
        const inner = node.callee.object;
        const status = readStatusArg(resolveConstInit(context, inner.arguments[0]));
        if (status == null || status < 400) return;
        const arg = resolveConstInit(context, node.arguments[0], { soleRead: true });
        const missing = findMissingFields(arg);
        if (!missing || missing.length === 0) return;
        context.report({
          node,
          messageId: 'missingFields',
          data: { status: String(status), missing: missing.join(', ') },
        });
      },

      ThrowStatement(node) {
        if (!node.argument) return;
        if (node.argument.type !== 'NewExpression') return;
        const callee = node.argument.callee;
        if (callee.type !== 'Identifier' || callee.name !== 'Error') return;

        // Walk up parents to see if we're inside a catch clause.
        let parent = node.parent;
        while (parent) {
          if (parent.type === 'CatchClause') return;
          parent = parent.parent;
        }
        context.report({ node, messageId: 'rawError' });
      },
    };
  },
};
