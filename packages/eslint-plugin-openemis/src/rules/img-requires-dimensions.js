/**
 * @fileoverview ESLint rule that enforces the ProctiraERP image strategy:
 *   1. Every `<img>` (or `<Img>`) JSX element must declare explicit
 *      `width` and `height` attributes (literal `width`/`height` JSX
 *      attributes, or a `style` object containing both `width` and
 *      `height`). This prevents Cumulative Layout Shift (CLS) by
 *      reserving space for the image before it loads.
 *   2. Below-the-fold images should declare `loading="lazy"`. The rule
 *      warns when `loading` is missing and the element is not marked
 *      as a hero / above-the-fold image (via `priority`,
 *      `fetchpriority="high"`, or `data-hero`).
 *
 * Decorative images marked with `aria-hidden` (and lacking meaningful
 * `alt` text) can optionally be allowed to skip both checks via the
 * `allowAriaHiddenDecorative` option (default `true`).
 *
 * Design J — Performance Budget Strategy (Requirement 39).
 *
 * Rule options (single object):
 *   {
 *     // JSX element names that should be checked. Defaults to ["img", "Img"].
 *     elementNames: string[],
 *     // When true, an aria-hidden image is allowed to skip dimension/loading checks.
 *     allowAriaHiddenDecorative: boolean,
 *   }
 */

'use strict';

const DEFAULT_ELEMENT_NAMES = ['img', 'Img'];

/**
 * Walk a JSX element's attributes into a lookup of name → AST node.
 * Spread attributes (`{...props}`) suppress all checks for that element
 * because we cannot statically know what they contain.
 */
function indexAttributes(opening) {
  const map = new Map();
  let hasSpread = false;
  for (const attr of opening.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      hasSpread = true;
      continue;
    }
    if (attr.type === 'JSXAttribute' && attr.name && attr.name.type === 'JSXIdentifier') {
      map.set(attr.name.name, attr);
    }
  }
  return { map, hasSpread };
}

/**
 * Returns true if the JSX attribute has a non-empty literal value or any
 * expression value. Empty string literal counts as missing.
 */
function attributeHasValue(attr) {
  if (!attr || !attr.value) return false;
  const value = attr.value;
  if (value.type === 'Literal') {
    return value.value !== '' && value.value !== false && value.value !== null;
  }
  // JSXExpressionContainer: trust that the expression provides a value.
  if (value.type === 'JSXExpressionContainer') {
    if (
      value.expression &&
      value.expression.type === 'Literal' &&
      (value.expression.value === '' ||
        value.expression.value === null ||
        value.expression.value === undefined)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * If the attribute is `attr={{ ...object literal... }}`, return the
 * ObjectExpression node. Otherwise null.
 */
function extractStyleObject(attr) {
  if (
    !attr ||
    !attr.value ||
    attr.value.type !== 'JSXExpressionContainer' ||
    !attr.value.expression
  ) {
    return null;
  }
  const expr = attr.value.expression;
  if (expr.type === 'ObjectExpression') return expr;
  return null;
}

/**
 * Returns true when the style object literal contains a property with
 * the given name (string or identifier key) and a non-empty value.
 */
function styleHasProperty(objectExpression, propName) {
  if (!objectExpression) return false;
  for (const prop of objectExpression.properties) {
    if (prop.type !== 'Property' && prop.type !== 'ObjectProperty') continue;
    const key = prop.key;
    let keyName = null;
    if (key.type === 'Identifier') keyName = key.name;
    else if (key.type === 'Literal' && typeof key.value === 'string') keyName = key.value;
    if (keyName === propName) {
      // Reject empty string literal explicitly; otherwise assume valid.
      if (prop.value && prop.value.type === 'Literal' && prop.value.value === '') {
        return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * Returns true when the attribute represents a literal string equal to
 * the expected value (case-sensitive).
 */
function attributeEquals(attr, expected) {
  if (!attr || !attr.value) return false;
  if (attr.value.type === 'Literal') {
    return attr.value.value === expected;
  }
  if (
    attr.value.type === 'JSXExpressionContainer' &&
    attr.value.expression &&
    attr.value.expression.type === 'Literal'
  ) {
    return attr.value.expression.value === expected;
  }
  return false;
}

/**
 * Returns true when the JSX element is marked as a hero / above-the-fold
 * image and therefore should not be required to lazy-load.
 *   - `priority` boolean prop (Next.js convention)
 *   - `fetchpriority="high"`
 *   - `data-hero`
 */
function isHero(attrs) {
  if (attrs.has('priority')) return true;
  if (attributeEquals(attrs.get('fetchpriority'), 'high')) return true;
  if (attrs.has('data-hero')) return true;
  return false;
}

/**
 * Returns true when the element is `aria-hidden="true"` (or just
 * `aria-hidden` boolean shorthand which evaluates to true in JSX).
 */
function isAriaHidden(attrs) {
  const attr = attrs.get('aria-hidden');
  if (!attr) return false;
  if (!attr.value) return true; // <img aria-hidden /> shorthand
  return (
    attributeEquals(attr, 'true') ||
    (attr.value.type === 'JSXExpressionContainer' &&
      attr.value.expression &&
      attr.value.expression.type === 'Literal' &&
      attr.value.expression.value === true)
  );
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require explicit width/height on <img> elements to prevent layout shift; warn when below-the-fold images are missing loading="lazy".',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          elementNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          allowAriaHiddenDecorative: {
            type: 'boolean',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingWidth:
        '<{{name}}> is missing an explicit `width` attribute. Specify width and height to prevent layout shift (CLS).',
      missingHeight:
        '<{{name}}> is missing an explicit `height` attribute. Specify width and height to prevent layout shift (CLS).',
      missingLoading:
        '<{{name}}> is missing `loading="lazy"`. Add it for below-the-fold images, or mark the element as `priority` / `fetchpriority="high"` / `data-hero` if it is above the fold.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const elementNames = options.elementNames || DEFAULT_ELEMENT_NAMES;
    const allowAriaHiddenDecorative = options.allowAriaHiddenDecorative !== false;

    return {
      JSXOpeningElement(node) {
        // Only check JSX elements with a plain identifier name we recognise.
        if (!node.name || node.name.type !== 'JSXIdentifier') return;
        if (!elementNames.includes(node.name.name)) return;

        const elementName = node.name.name;
        const { map: attrs, hasSpread } = indexAttributes(node);

        // Spread attributes: we cannot statically verify, so skip.
        if (hasSpread) return;

        // Decorative images can opt out.
        if (allowAriaHiddenDecorative && isAriaHidden(attrs)) return;

        const styleObject = extractStyleObject(attrs.get('style'));

        const widthOk =
          attributeHasValue(attrs.get('width')) || styleHasProperty(styleObject, 'width');
        const heightOk =
          attributeHasValue(attrs.get('height')) || styleHasProperty(styleObject, 'height');

        if (!widthOk) {
          context.report({
            node,
            messageId: 'missingWidth',
            data: { name: elementName },
          });
        }
        if (!heightOk) {
          context.report({
            node,
            messageId: 'missingHeight',
            data: { name: elementName },
          });
        }

        // Loading check: skip hero / above-the-fold images.
        if (!isHero(attrs)) {
          const hasLoading = attributeHasValue(attrs.get('loading'));
          if (!hasLoading) {
            context.report({
              node,
              messageId: 'missingLoading',
              data: { name: elementName },
            });
          }
        }
      },
    };
  },
};
