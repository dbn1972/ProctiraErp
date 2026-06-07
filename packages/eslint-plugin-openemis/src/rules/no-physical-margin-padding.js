/**
 * @fileoverview ESLint rule that flags physical-axis directional Tailwind utilities
 * and suggests logical equivalents for RTL compatibility.
 *
 * Flagged patterns:
 *   ml-*, mr-*, pl-*, pr-*, left-*, right-*, border-l-*, border-r-*, text-left, text-right
 *
 * Suggested replacements:
 *   ms-*, me-*, ps-*, pe-*, start-*, end-*, border-s-*, border-e-*, text-start, text-end
 */

"use strict";

/** @type {Array<{pattern: RegExp, replacement: (match: string) => string, description: string}>} */
const PHYSICAL_TO_LOGICAL = [
  {
    // ml-0, ml-1, ml-2, ml-px, ml-auto, ml-[10px], -ml-2, etc.
    pattern: /^(-?)ml-(.+)$/,
    replacement: (_match, neg, value) => `${neg}ms-${value}`,
    description: "ms-* (margin-inline-start)",
  },
  {
    // mr-0, mr-1, mr-auto, etc.
    pattern: /^(-?)mr-(.+)$/,
    replacement: (_match, neg, value) => `${neg}me-${value}`,
    description: "me-* (margin-inline-end)",
  },
  {
    // pl-0, pl-1, pl-px, etc.
    pattern: /^(-?)pl-(.+)$/,
    replacement: (_match, neg, value) => `${neg}ps-${value}`,
    description: "ps-* (padding-inline-start)",
  },
  {
    // pr-0, pr-1, pr-auto, etc.
    pattern: /^(-?)pr-(.+)$/,
    replacement: (_match, neg, value) => `${neg}pe-${value}`,
    description: "pe-* (padding-inline-end)",
  },
  {
    // left-0, left-1, left-full, left-[10px], -left-2, etc.
    pattern: /^(-?)left-(.+)$/,
    replacement: (_match, neg, value) => `${neg}start-${value}`,
    description: "start-* (inset-inline-start)",
  },
  {
    // right-0, right-1, right-full, etc.
    pattern: /^(-?)right-(.+)$/,
    replacement: (_match, neg, value) => `${neg}end-${value}`,
    description: "end-* (inset-inline-end)",
  },
  {
    // border-l, border-l-2, border-l-[3px], etc.
    pattern: /^border-l(-(.+))?$/,
    replacement: (_match, suffix) => `border-s${suffix || ""}`,
    description: "border-s-* (border-inline-start)",
  },
  {
    // border-r, border-r-2, border-r-[3px], etc.
    pattern: /^border-r(-(.+))?$/,
    replacement: (_match, suffix) => `border-e${suffix || ""}`,
    description: "border-e-* (border-inline-end)",
  },
  {
    // text-left
    pattern: /^text-left$/,
    replacement: () => "text-start",
    description: "text-start",
  },
  {
    // text-right
    pattern: /^text-right$/,
    replacement: () => "text-end",
    description: "text-end",
  },
];

/**
 * Check if a class name matches any physical-axis pattern.
 * Returns the match info or null.
 */
function findPhysicalClass(className) {
  // Strip responsive/state prefixes like "sm:", "md:", "hover:", "dark:", etc.
  const prefixMatch = className.match(/^((?:[a-z0-9]+:)*)(.+)$/);
  if (!prefixMatch) return null;

  const prefix = prefixMatch[1]; // e.g. "sm:hover:" or ""
  const utility = prefixMatch[2]; // e.g. "ml-4"

  for (const mapping of PHYSICAL_TO_LOGICAL) {
    const match = utility.match(mapping.pattern);
    if (match) {
      const fixed = mapping.replacement(match[0], ...match.slice(1));
      return {
        original: className,
        fixed: prefix + fixed,
        description: mapping.description,
      };
    }
  }
  return null;
}

/**
 * Extract individual class names from a string value (className prop value).
 * Returns array of { className, startIndex } relative to the string content.
 */
function extractClasses(value) {
  const classes = [];
  const regex = /[^\s]+/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    classes.push({ className: match[0], startIndex: match.index });
  }
  return classes;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow physical-axis directional Tailwind utilities; use logical equivalents for RTL support",
      category: "Best Practices",
      recommended: true,
    },
    fixable: "code",
    schema: [],
    messages: {
      physicalClass:
        'Avoid physical-axis utility "{{original}}". Use logical equivalent "{{fixed}}" ({{description}}) for RTL compatibility.',
    },
  },

  create(context) {
    /**
     * Check a string literal or template literal for physical classes.
     */
    function checkStringForPhysicalClasses(node, value, valueStartOffset) {
      const classes = extractClasses(value);
      for (const { className, startIndex } of classes) {
        const result = findPhysicalClass(className);
        if (result) {
          // Calculate the range within the source for the specific class
          const nodeStart = node.range[0] + valueStartOffset + startIndex;
          const nodeEnd = nodeStart + className.length;

          context.report({
            node,
            messageId: "physicalClass",
            data: {
              original: result.original,
              fixed: result.fixed,
              description: result.description,
            },
            fix(fixer) {
              return fixer.replaceTextRange(
                [nodeStart, nodeEnd],
                result.fixed
              );
            },
          });
        }
      }
    }

    /**
     * Check if a JSX attribute is a className-like prop.
     */
    function isClassNameProp(attrName) {
      return attrName === "className" || attrName === "class";
    }

    /**
     * Visitor for JSX attributes with className.
     */
    function checkJSXAttribute(node) {
      if (
        !node.name ||
        !isClassNameProp(node.name.name)
      ) {
        return;
      }

      const value = node.value;
      if (!value) return;

      // className="some classes"
      if (value.type === "Literal" && typeof value.value === "string") {
        // +1 for the opening quote
        checkStringForPhysicalClasses(node, value.value, value.range[0] - node.range[0] + 1);
        return;
      }

      // className={`template`} or className={someExpression}
      if (value.type === "JSXExpressionContainer") {
        visitExpression(value.expression);
      }
    }

    /**
     * Recursively visit expressions to find string literals and template literals.
     */
    function visitExpression(expr) {
      if (!expr) return;

      // String literal: "classes"
      if (expr.type === "Literal" && typeof expr.value === "string") {
        checkStringForPhysicalClasses(expr, expr.value, 1); // +1 for quote
        return;
      }

      // Template literal: `classes ${var} more`
      if (expr.type === "TemplateLiteral") {
        for (const quasi of expr.quasis) {
          if (quasi.value && quasi.value.raw) {
            // quasi.range[0] + 1 accounts for the backtick/}
            const offset = quasi.range[0] - expr.range[0] + 1;
            checkStringForPhysicalClasses(
              expr,
              quasi.value.raw,
              offset
            );
          }
        }
        // Also check expressions within the template
        for (const expression of expr.expressions) {
          visitExpression(expression);
        }
        return;
      }

      // Function calls like cn("ml-4", "p-2"), clsx("ml-4"), twMerge(...)
      if (expr.type === "CallExpression") {
        for (const arg of expr.arguments) {
          visitExpression(arg);
        }
        return;
      }

      // Conditional: condition ? "ml-4" : "mr-4"
      if (expr.type === "ConditionalExpression") {
        visitExpression(expr.consequent);
        visitExpression(expr.alternate);
        return;
      }

      // Logical: someCondition && "ml-4"
      if (expr.type === "LogicalExpression") {
        visitExpression(expr.left);
        visitExpression(expr.right);
        return;
      }

      // Array: ["ml-4", "p-2"]
      if (expr.type === "ArrayExpression") {
        for (const element of expr.elements) {
          if (element) visitExpression(element);
        }
        return;
      }
    }

    return {
      JSXAttribute: checkJSXAttribute,
    };
  },
};
