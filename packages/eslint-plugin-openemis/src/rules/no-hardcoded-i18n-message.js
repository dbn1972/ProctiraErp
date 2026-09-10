/**
 * @fileoverview ESLint rule that flags hardcoded user-facing strings in the
 * `message` field of route response payloads. Charter §17 (Localization) and
 * §32 require all user-facing copy to flow through the i18n layer.
 *
 * The rule is intentionally narrow: it only inspects `message: "..."`
 * properties so it doesn't churn unrelated strings. It accepts:
 *   - dotted i18n keys ("error.invalid_input")
 *   - upper-case constants ("VALIDATION_ERROR")
 *   - short status words ("ok", "created")
 *   - template literals (presumed to use a t() inside)
 *
 * Mirrors tools/dod-checks/src/checks/i18n-readiness.mjs.
 */

'use strict';

const ACCEPTABLE_PATTERNS = [
  /^[a-z][a-z0-9_]+(\.[a-z0-9_]+)+$/,
  /^[A-Z][A-Z0-9_]+$/,
  /^(ok|success|created|deleted|updated|accepted|noContent)$/i,
];

const SHORT_THRESHOLD = 20;

function isAcceptable(value) {
  if (value.length <= SHORT_THRESHOLD) return true;
  return ACCEPTABLE_PATTERNS.some((p) => p.test(value));
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow hardcoded user-facing strings in the `message` property of route response payloads.',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      hardcoded:
        'Hardcoded user-facing string in `message`: "{{preview}}". Use an i18n key (e.g. "error.invalid_input") and resolve via t().',
    },
  },

  create(context) {
    function checkProperty(node) {
      if (node.type !== 'Property') return;
      // Property key must be `message` (identifier or literal).
      const keyName =
        node.key.type === 'Identifier'
          ? node.key.name
          : node.key.type === 'Literal'
            ? node.key.value
            : null;
      if (keyName !== 'message') return;
      // Value must be a plain string literal.
      if (node.value.type !== 'Literal') return;
      if (typeof node.value.value !== 'string') return;
      const value = node.value.value;
      if (isAcceptable(value)) return;
      context.report({
        node: node.value,
        messageId: 'hardcoded',
        data: { preview: value.length > 60 ? `${value.slice(0, 57)}...` : value },
      });
    }

    return {
      Property: checkProperty,
    };
  },
};
