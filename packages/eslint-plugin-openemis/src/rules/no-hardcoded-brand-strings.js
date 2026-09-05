/**
 * @fileoverview ESLint rule that flags any literal occurrence of a tenant
 * brand name (default: "ProctiraERP", "EduZo") in source files. Charter §32 +
 * Design §M (Brand-Name Flexibility, Requirement 43): every visible brand
 * string MUST come from `useBrand()` / `<DocumentTitle>` / brand config so
 * white-label deployments can rename the product without touching code.
 *
 * The rule inspects:
 *   - JSX text nodes ............... `<h1>ProctiraERP</h1>`
 *   - JSX attribute string literals  `<title>ProctiraERP</title>`, `alt="ProctiraERP Logo"`
 *   - Plain `Literal` strings ...... `title: "ProctiraERP"`, `subject: "Welcome to ProctiraERP"`
 *   - `TemplateElement` quasis ..... `` `Welcome to ProctiraERP, ${user}` ``
 *
 * Brand matching is case-insensitive and word-boundary aware so things like
 * `theProctiraERPClass` (an identifier-style substring) are NOT flagged but
 * `Welcome to ProctiraERP` IS flagged.
 *
 * Allowlist (the rule does nothing in these files):
 *   - `**\/*.config.{ts,js,mjs,cjs}`            (Next.js / Vite / Vitest configs)
 *   - `**\/theme.css`                          (Tailwind v4 token sheet)
 *   - any file under `packages/ui/branding/`  (default brand assets)
 *   - locale catalogs under `packages/shared/i18n/locales/**` whose source
 *     contains the top-level marker `"_brand": true` (or `_brand: true`)
 *
 * Comments are not string literals in the AST, so JSDoc / license headers
 * that mention a brand are already ignored by construction.
 *
 * Configuration (rule options object):
 *   {
 *     "brands": string[]   // brand names to flag (default: ["ProctiraERP", "EduZo"])
 *   }
 */

"use strict";

const path = require("path");

const DEFAULT_BRANDS = ["ProctiraERP", "Proctira", "EduZo"];

const DOCS_URL =
  "https://proctira.dev/docs/eslint/no-hardcoded-brand-strings";

/**
 * Escape a string so it can be embedded in a RegExp source.
 * @param {string} s
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a single case-insensitive RegExp that matches any brand at a
 * "human prose" boundary. The boundary is stricter than `\b`: in addition
 * to letters and digits, the characters `-`, `_`, `.`, `/`, `@`, and `:` are
 * treated as part of an identifier, so the brand will NOT match inside
 * tokens that look like CSS classes (`proctira-data-grid`), package paths
 * (`@proctira/auth`), hostnames (`audit.proctira.com`), URL paths
 * (`/proctira/login`), storage keys (`proctira-theme`), or env-style
 * names (`OPENEMIS_API_KEY`).
 *
 * The capture group lets callers know *which* brand matched so the
 * diagnostic message can quote it verbatim.
 *
 * Matches    : "ProctiraERP", "proctira", "Welcome to ProctiraERP!", "ProctiraERP,"
 * Non-matches: "proctira-data-grid", "@proctira/auth", "proctira.org",
 *              "TheProctiraERPClass", "myproctira2024", "proctira_token"
 */
const IDENTIFIER_CHARS = "A-Za-z0-9\\-_./@:";

function buildBrandRegex(brands) {
  const alternation = brands.map((b) => escapeRegExp(b)).join("|");
  return new RegExp(
    `(?<![${IDENTIFIER_CHARS}])(${alternation})(?![${IDENTIFIER_CHARS}])`,
    "gi",
  );
}

/**
 * Normalize an absolute filename to a forward-slash, repo-relative path so
 * the allowlist patterns work the same on Windows and macOS/Linux. We can't
 * always know the repo root here, so we fall back to the raw path. Either
 * works because all the patterns we test are suffix-matches.
 */
function normalizePath(filename) {
  if (!filename) return "";
  return filename.split(path.sep).join("/");
}

/**
 * Returns true if the file is in the static allowlist (config files, theme
 * stylesheet, brand asset folder).
 */
function isStaticAllowlistedFile(filename) {
  if (!filename) return false;
  const p = normalizePath(filename);
  // *.config.{ts,js,mjs,cjs}
  if (/\.config\.(ts|js|mjs|cjs)$/i.test(p)) return true;
  // theme.css
  if (/(^|\/)theme\.css$/i.test(p)) return true;
  // packages/ui/branding/**
  if (/\/packages\/ui\/branding\//.test(p)) return true;
  return false;
}

/**
 * Returns true if the file is a locale catalog under
 * `packages/shared/i18n/locales/**` AND its source contains the top-level
 * `_brand: true` marker. Both `_brand: true` (TS object) and `"_brand": true`
 * (JSON-style) are recognized.
 */
function isBrandMarkedLocaleCatalog(filename, sourceText) {
  if (!filename || !sourceText) return false;
  const p = normalizePath(filename);
  if (!/\/packages\/shared\/i18n\/locales\//.test(p)) return false;
  return /["']?_brand["']?\s*:\s*true\b/.test(sourceText);
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hardcoded tenant brand names (e.g. 'ProctiraERP', 'EduZo') in source code; resolve them from `useBrand()` / brand config so the platform stays white-label-friendly.",
      category: "Best Practices",
      recommended: true,
      url: DOCS_URL,
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          brands: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
            minItems: 1,
          },
        },
      },
    ],
    messages: {
      hardcoded:
        'Brand string "{{brand}}" must come from useBrand() / brand config.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const brands =
      Array.isArray(options.brands) && options.brands.length > 0
        ? options.brands
        : DEFAULT_BRANDS;

    const filename =
      typeof context.getFilename === "function" ? context.getFilename() : "";

    if (isStaticAllowlistedFile(filename)) {
      return {};
    }

    // Locale-catalog allowlist needs the source text to look for the marker.
    const sourceCode =
      typeof context.getSourceCode === "function"
        ? context.getSourceCode()
        : context.sourceCode;
    const sourceText = sourceCode && sourceCode.getText ? sourceCode.getText() : "";
    if (isBrandMarkedLocaleCatalog(filename, sourceText)) {
      return {};
    }

    const brandRegex = buildBrandRegex(brands);

    /**
     * Report every brand match in `text` against `node`. Resets the regex
     * lastIndex for each call so it can be reused safely.
     */
    function reportMatches(node, text) {
      if (typeof text !== "string" || text.length === 0) return;
      brandRegex.lastIndex = 0;
      let match;
      while ((match = brandRegex.exec(text)) !== null) {
        context.report({
          node,
          messageId: "hardcoded",
          data: { brand: match[1] },
        });
        // Guard against zero-width matches (shouldn't happen for our regex
        // but defensive).
        if (match.index === brandRegex.lastIndex) {
          brandRegex.lastIndex += 1;
        }
      }
    }

    /**
     * True if a `Literal` node is the source of an import / export / dynamic
     * import / `require()` call. Those are module specifiers, not user-facing
     * copy, and tenants legitimately keep the package name fixed.
     */
    function isModuleSpecifierLiteral(node) {
      const parent = node.parent;
      if (!parent) return false;
      if (
        (parent.type === "ImportDeclaration" ||
          parent.type === "ExportAllDeclaration" ||
          parent.type === "ExportNamedDeclaration") &&
        parent.source === node
      ) {
        return true;
      }
      if (
        parent.type === "ImportExpression" &&
        parent.source === node
      ) {
        return true;
      }
      if (
        parent.type === "CallExpression" &&
        parent.callee &&
        parent.callee.type === "Identifier" &&
        parent.callee.name === "require" &&
        parent.arguments[0] === node
      ) {
        return true;
      }
      return false;
    }

    return {
      // <h1>ProctiraERP</h1>
      JSXText(node) {
        reportMatches(node, node.value);
      },

      // String literals: title="ProctiraERP", { title: "ProctiraERP" }, etc.
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (isModuleSpecifierLiteral(node)) return;
        reportMatches(node, node.value);
      },

      // Template literals: `Welcome to ProctiraERP, ${user}`
      TemplateElement(node) {
        const cooked = node.value && node.value.cooked;
        if (typeof cooked !== "string" || cooked.length === 0) return;
        reportMatches(node, cooked);
      },
    };
  },
};
