/**
 * @fileoverview ESLint rule that flags any `<Button>` or `<IconButton>` (or
 * any element marked `data-icon-only`) whose only visible child is an icon
 * component when no accessible name is provided. Charter / Design §K
 * (Accessibility, Requirement 37.4): "Icon-only buttons require an
 * `aria-label`; a custom ESLint rule `icon-only-button-requires-aria-label`
 * flags `<button><Icon/></button>` patterns without a label."
 *
 * A button is considered to have an accessible name when ANY of the following
 * is present:
 *   - `aria-label`           (string, JSXExpressionContainer, etc.)
 *   - `aria-labelledby`
 *   - `title`
 *   - a visually-hidden text node child, e.g.
 *       <span className="sr-only">Delete</span>
 *       <span className="visually-hidden">Delete</span>
 *
 * "Icon-only" detection treats the following children as icons:
 *   - JSX elements whose tag name ends with `Icon`
 *     (e.g. `<TrashIcon/>`, `<ChevronRightIcon/>`)
 *   - JSX elements imported from any of the configured icon packages
 *     (default: `lucide-react`, `@heroicons/react`, `@heroicons/react/24/outline`,
 *      `@heroicons/react/24/solid`, `@heroicons/react/20/solid`,
 *      `react-icons`)
 *   - JSX elements whose tag name matches the configurable
 *     `iconNamePattern` regex
 *   - Self-closing `<svg>` elements
 *
 * The rule also accepts JSX whitespace and string-literal children that are
 * empty / whitespace-only so things like
 *     <Button> <TrashIcon/> </Button>
 * are still flagged.
 *
 * Configuration (rule options object):
 *   {
 *     "components":      string[]   // additional component names to check
 *     "iconNamePattern": string     // regex to match icon component names (default `Icon$`)
 *     "iconPackages":    string[]   // import sources whose default/named imports are icons
 *   }
 */

"use strict";

const DEFAULT_BUTTON_COMPONENTS = ["Button", "IconButton"];
const DEFAULT_ICON_PACKAGES = [
  "lucide-react",
  "react-icons",
  "@heroicons/react",
  "@heroicons/react/24/outline",
  "@heroicons/react/24/solid",
  "@heroicons/react/20/solid",
  "@heroicons/react/16/solid",
];
const DEFAULT_ICON_NAME_PATTERN = "Icon$";
const VISUALLY_HIDDEN_CLASS_RE =
  /(?:^|\s)(?:sr-only|visually-hidden|visually_hidden|screen-reader-only|screenreader-only|aria-hidden)(?:\s|$)/;

const DOCS_URL =
  "https://proctira.dev/docs/eslint/icon-only-button-requires-aria-label";

/**
 * Get the JSX element tag name as a string (handles `<Foo>` and `<Foo.Bar>`).
 */
function getJsxName(nameNode) {
  if (!nameNode) return null;
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") {
    const object = getJsxName(nameNode.object);
    return object ? `${object}.${nameNode.property.name}` : nameNode.property.name;
  }
  if (nameNode.type === "JSXNamespacedName") {
    return `${nameNode.namespace.name}:${nameNode.name.name}`;
  }
  return null;
}

/**
 * Get the simple (last-segment) name for matching (`Foo.Bar` -> `Bar`).
 */
function getSimpleName(fullName) {
  if (!fullName) return null;
  const parts = fullName.split(".");
  return parts[parts.length - 1];
}

/**
 * Find an attribute by name on a JSX opening element. Returns the
 * JSXAttribute node, or null if not present (or only present as a spread).
 */
function findAttribute(openingElement, name) {
  for (const attr of openingElement.attributes) {
    if (attr.type === "JSXAttribute" && attr.name && attr.name.name === name) {
      return attr;
    }
  }
  return null;
}

/**
 * Returns true if the JSX attribute resolves to a non-empty value at lint
 * time. We are conservative: a JSXExpressionContainer is considered "present"
 * unless its expression is a literal empty string / null / undefined / false.
 */
function attributeHasMeaningfulValue(attr) {
  if (!attr) return false;
  // Bare boolean attribute (`<Button aria-label />`) is not meaningful.
  if (attr.value == null) return false;

  if (attr.value.type === "Literal") {
    if (typeof attr.value.value === "string") {
      return attr.value.value.trim().length > 0;
    }
    return Boolean(attr.value.value);
  }

  if (attr.value.type === "JSXExpressionContainer") {
    const expr = attr.value.expression;
    if (!expr) return false;
    if (expr.type === "JSXEmptyExpression") return false;
    if (expr.type === "Literal") {
      if (expr.value === null) return false;
      if (typeof expr.value === "string") return expr.value.trim().length > 0;
      return Boolean(expr.value);
    }
    if (expr.type === "TemplateLiteral") {
      // `${var}` is ambiguous — treat as present.
      if (expr.expressions.length > 0) return true;
      return expr.quasis.some(
        (q) => q.value && q.value.cooked && q.value.cooked.trim().length > 0,
      );
    }
    if (expr.type === "Identifier" && expr.name === "undefined") return false;
    return true;
  }

  return false;
}

/**
 * Returns true if the opening element has a className containing a
 * visually-hidden utility class (sr-only, visually-hidden, etc.).
 */
function hasVisuallyHiddenClass(openingElement) {
  const cls = findAttribute(openingElement, "className");
  if (!cls || !cls.value) return false;
  if (cls.value.type === "Literal" && typeof cls.value.value === "string") {
    return VISUALLY_HIDDEN_CLASS_RE.test(cls.value.value);
  }
  if (cls.value.type === "JSXExpressionContainer") {
    const expr = cls.value.expression;
    if (expr && expr.type === "Literal" && typeof expr.value === "string") {
      return VISUALLY_HIDDEN_CLASS_RE.test(expr.value);
    }
    if (expr && expr.type === "TemplateLiteral") {
      return expr.quasis.some(
        (q) => q.value && q.value.cooked && VISUALLY_HIDDEN_CLASS_RE.test(q.value.cooked),
      );
    }
  }
  return false;
}

/**
 * A child counts as "empty" (whitespace text, comments) and can be skipped.
 */
function isEmptyChild(child) {
  if (!child) return true;
  if (child.type === "JSXText") {
    return child.value.trim().length === 0;
  }
  if (child.type === "Literal" && typeof child.value === "string") {
    return child.value.trim().length === 0;
  }
  if (child.type === "JSXExpressionContainer") {
    const expr = child.expression;
    if (!expr) return true;
    if (expr.type === "JSXEmptyExpression") return true;
    if (expr.type === "Literal" && (expr.value === null || expr.value === false)) return true;
    if (expr.type === "Identifier" && expr.name === "undefined") return true;
    if (expr.type === "Literal" && typeof expr.value === "string" && expr.value.trim() === "") return true;
  }
  return false;
}

/**
 * A child counts as visible/non-empty text content if it's a non-blank
 * JSXText, a string Literal, or a JSXExpressionContainer wrapping a
 * non-empty string literal / template literal.
 */
function isVisibleTextChild(child) {
  if (!child) return false;
  if (child.type === "JSXText") return child.value.trim().length > 0;
  if (child.type === "Literal" && typeof child.value === "string") {
    return child.value.trim().length > 0;
  }
  if (child.type === "JSXExpressionContainer") {
    const expr = child.expression;
    if (!expr) return false;
    if (expr.type === "Literal" && typeof expr.value === "string") {
      return expr.value.trim().length > 0;
    }
    if (expr.type === "TemplateLiteral") {
      if (expr.expressions.length > 0) return true;
      return expr.quasis.some(
        (q) => q.value && q.value.cooked && q.value.cooked.trim().length > 0,
      );
    }
    // Function calls (e.g. t('key')) — assume they yield visible text.
    if (expr.type === "CallExpression") return true;
    // Identifier reference — could be a label var; assume visible text.
    if (expr.type === "Identifier" && expr.name !== "undefined") return true;
  }
  return false;
}

/**
 * Returns true if the JSX element child is itself a visually-hidden text
 * wrapper (e.g. `<span className="sr-only">Delete</span>` with non-empty
 * text inside). This satisfies the icon+label rule.
 */
function isVisuallyHiddenLabel(child) {
  if (!child || child.type !== "JSXElement") return false;
  if (!hasVisuallyHiddenClass(child.openingElement)) return false;
  // Must contain at least one visible text child to be a real label.
  return child.children.some((c) => isVisibleTextChild(c));
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an accessible name (aria-label, aria-labelledby, title, or visually-hidden label) on icon-only buttons.",
      category: "Accessibility",
      recommended: true,
      url: DOCS_URL,
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          components: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          iconNamePattern: { type: "string" },
          iconPackages: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
      },
    ],
    messages: {
      missingAccessibleName:
        "Icon-only <{{component}}> must have an accessible name. Add `aria-label`, `aria-labelledby`, `title`, or a visually-hidden text label (e.g. <span className=\"sr-only\">…</span>). See {{url}}.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const buttonComponents = new Set([
      ...DEFAULT_BUTTON_COMPONENTS,
      ...(Array.isArray(options.components) ? options.components : []),
    ]);
    const iconPackages = new Set(
      Array.isArray(options.iconPackages)
        ? options.iconPackages
        : DEFAULT_ICON_PACKAGES,
    );
    let iconNameRegex;
    try {
      iconNameRegex = new RegExp(options.iconNamePattern || DEFAULT_ICON_NAME_PATTERN);
    } catch (err) {
      iconNameRegex = new RegExp(DEFAULT_ICON_NAME_PATTERN);
    }

    /**
     * Track imports from known icon packages so we can flag custom-named
     * icons (e.g. `import { Trash as Bin } from 'lucide-react'`).
     */
    const iconImportNames = new Set();

    function isIconJsxElement(child) {
      if (!child) return false;
      if (child.type === "JSXFragment") {
        // Fragment containing only icons counts as icon-only too.
        return child.children.length > 0 && child.children.every((c) => isEmptyChild(c) || isIconJsxElement(c));
      }
      if (child.type !== "JSXElement") return false;
      const fullName = getJsxName(child.openingElement.name);
      if (!fullName) return false;
      const simple = getSimpleName(fullName);

      // Native <svg/> is treated as an icon.
      if (fullName === "svg") return true;

      if (iconImportNames.has(simple)) return true;
      if (iconNameRegex.test(simple)) return true;

      return false;
    }

    /**
     * Should this opening element be checked at all? It must be one of the
     * configured button components OR carry a `data-icon-only` attribute.
     */
    function shouldCheck(openingElement) {
      const fullName = getJsxName(openingElement.name);
      if (!fullName) return { check: false };
      const simple = getSimpleName(fullName);
      if (buttonComponents.has(simple) || buttonComponents.has(fullName)) {
        return { check: true, name: fullName };
      }
      if (findAttribute(openingElement, "data-icon-only")) {
        return { check: true, name: fullName };
      }
      return { check: false };
    }

    /**
     * Returns `true` if the children list represents an icon-only payload:
     * exactly one icon JSX element after stripping whitespace, with no
     * visible text content and no visually-hidden label.
     */
    function isIconOnly(children) {
      let iconCount = 0;
      let hasVisibleText = false;
      let hasHiddenLabel = false;
      let hasNonIconElement = false;

      for (const child of children) {
        if (isEmptyChild(child)) continue;
        if (isVisuallyHiddenLabel(child)) {
          hasHiddenLabel = true;
          continue;
        }
        // An empty sr-only/visually-hidden wrapper carries no label text, so
        // we skip it and let the icon-only detection still flag the button.
        if (
          child.type === "JSXElement" &&
          hasVisuallyHiddenClass(child.openingElement)
        ) {
          continue;
        }
        if (isVisibleTextChild(child)) {
          hasVisibleText = true;
          continue;
        }
        if (isIconJsxElement(child)) {
          iconCount += 1;
          continue;
        }
        // JSXExpressionContainer with a non-string non-template expression
        // we can't statically evaluate — treat as non-icon to avoid false
        // positives.
        if (child.type === "JSXExpressionContainer") {
          hasNonIconElement = true;
          continue;
        }
        // JSXElement that isn't an icon → treat as non-icon content.
        if (child.type === "JSXElement" || child.type === "JSXFragment") {
          hasNonIconElement = true;
          continue;
        }
      }

      if (hasHiddenLabel) return false;
      if (hasVisibleText) return false;
      if (hasNonIconElement) return false;
      return iconCount >= 1;
    }

    function hasAccessibleNameAttribute(openingElement) {
      if (attributeHasMeaningfulValue(findAttribute(openingElement, "aria-label"))) return true;
      if (attributeHasMeaningfulValue(findAttribute(openingElement, "aria-labelledby"))) return true;
      if (attributeHasMeaningfulValue(findAttribute(openingElement, "title"))) return true;
      return false;
    }

    return {
      ImportDeclaration(node) {
        const source = node.source && node.source.value;
        if (!source || typeof source !== "string") return;
        // Match exact package or any subpath, e.g. `@heroicons/react/24/outline`.
        let matches = false;
        for (const pkg of iconPackages) {
          if (source === pkg || source.startsWith(`${pkg}/`)) {
            matches = true;
            break;
          }
        }
        if (!matches) return;
        for (const spec of node.specifiers) {
          if (
            spec.type === "ImportSpecifier" ||
            spec.type === "ImportDefaultSpecifier" ||
            spec.type === "ImportNamespaceSpecifier"
          ) {
            if (spec.local && spec.local.name) {
              iconImportNames.add(spec.local.name);
            }
          }
        }
      },

      JSXElement(node) {
        const opening = node.openingElement;
        const decision = shouldCheck(opening);
        if (!decision.check) return;

        // Self-closing buttons can never be icon-only — there are no children.
        if (opening.selfClosing) return;

        if (!isIconOnly(node.children)) return;

        // Allow a visually-hidden label as a sibling of the icon (handled in
        // isIconOnly via hasHiddenLabel), or any of the accessible-name attrs.
        if (hasAccessibleNameAttribute(opening)) return;

        context.report({
          node: opening,
          messageId: "missingAccessibleName",
          data: { component: decision.name, url: DOCS_URL },
        });
      },
    };
  },
};
