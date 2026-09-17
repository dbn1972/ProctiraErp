#!/usr/bin/env node
/**
 * UP-P0-02 — application runtimes must never replay migration SQL or issue DDL.
 * Uses the TypeScript AST with lexical binding resolution so aliases, helper
 * parameters, assignments, computed calls, and query config objects are handled
 * without treating bound parameter values as executable SQL.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const EXCLUDED_DIRECTORIES = new Set([
  'coverage',
  'dist',
  'fixtures',
  'generated',
  'node_modules',
  'test-results',
]);
const TEST_FILE = /(?:^|\.)(?:test|spec|live\.test)\.[cm]?[jt]sx?$/;
const SQL_ASSET_PATH = /(?:^|[\\/])db[\\/]sql[\\/]|\.sql(?:$|[?#])/i;
const FILE_READ_NAMES = new Set(['readFile', 'readFileSync']);
const DATABASE_EXECUTION_NAMES = new Set(['query', 'execute', '$executeRaw', '$executeRawUnsafe']);
const DDL_LITERAL =
  /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|COMMENT\s+ON|GRANT|REVOKE|DO\s+\$|REINDEX|CLUSTER|VACUUM)\b/i;

function scriptKind(path) {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isLexicalScope(node) {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isFunctionLike(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node)
  );
}

function nearestScope(node, sourceFile) {
  for (let current = node.parent; current; current = current.parent) {
    if (isLexicalScope(current)) return current;
  }
  return sourceFile;
}

function isConditionallyExecuted(node, scope) {
  for (let current = node.parent; current && current !== scope; current = current.parent) {
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isCaseClause(current) ||
      ts.isDefaultClause(current) ||
      (ts.isBinaryExpression(current) &&
        [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
          current.operatorToken.kind,
        ))
    ) {
      return true;
    }
  }
  return false;
}

function functionReturns(body) {
  if (!body) return [];
  if (!ts.isBlock(body)) return [body];
  const returns = [];
  function visit(node) {
    if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression);
    // Nested functions own their returns and must not leak into the parent.
    if (node !== body && ts.isFunctionLike(node)) return;
    ts.forEachChild(node, visit);
  }
  visit(body);
  return returns;
}

function collectBindings(sourceFile) {
  const declarations = new Map();
  const calls = [];

  function add(name, binding) {
    const entries = declarations.get(name) ?? [];
    entries.push(binding);
    declarations.set(name, entries);
    return binding;
  }

  function addFunction(node, name, scope, position) {
    const binding = add(name, {
      kind: 'function',
      name,
      node,
      scope,
      position,
      returns: functionReturns(node.body),
      parameters: [],
    });
    node.parameters.forEach((parameter, index) => {
      if (!ts.isIdentifier(parameter.name)) return;
      const parameterBinding = add(parameter.name.text, {
        kind: 'parameter',
        name: parameter.name.text,
        node: parameter,
        scope: node,
        position: -1,
        owner: binding,
        parameterIndex: index,
      });
      binding.parameters.push(parameterBinding);
    });
    return binding;
  }

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].includes(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        add(element.name.text, {
          kind: 'callable',
          name: element.name.text,
          callableName: imported,
          node: element,
          scope: sourceFile,
          position: -1,
        });
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      addFunction(node, node.name.text, nearestScope(node, sourceFile), -1);
    }

    if (ts.isVariableDeclaration(node)) {
      const scope = nearestScope(node, sourceFile);
      if (ts.isIdentifier(node.name)) {
        const binding = add(node.name.text, {
          kind: 'value',
          name: node.name.text,
          node,
          scope,
          position: node.getStart(sourceFile),
          value: node.initializer,
        });
        if (
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
          binding.kind = 'function';
          binding.returns = functionReturns(node.initializer.body);
          binding.parameters = [];
          node.initializer.parameters.forEach((parameter, index) => {
            if (!ts.isIdentifier(parameter.name)) return;
            const parameterBinding = add(parameter.name.text, {
              kind: 'parameter',
              name: parameter.name.text,
              node: parameter,
              scope: node.initializer,
              position: -1,
              owner: binding,
              parameterIndex: index,
            });
            binding.parameters.push(parameterBinding);
          });
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const propertyName = element.propertyName
            ? element.propertyName.getText(sourceFile).replace(/^['"]|['"]$/g, '')
            : element.name.text;
          add(element.name.text, {
            kind: 'callable',
            name: element.name.text,
            callableName: propertyName,
            node: element,
            scope,
            position: node.getStart(sourceFile),
          });
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const assignmentScope = nearestScope(node, sourceFile);
      add(node.left.text, {
        kind: 'value',
        name: node.left.text,
        node,
        scope: assignmentScope,
        position: node.getStart(sourceFile),
        conditional: isConditionallyExecuted(node, assignmentScope),
        value: node.right,
      });
    }

    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { sourceFile, declarations, calls };
}

function scopeChain(node) {
  const scopes = [];
  for (let current = node; current; current = current.parent) {
    if (isLexicalScope(current)) scopes.push(current);
  }
  return scopes;
}

function visibleBindings(name, useNode, bindings) {
  const candidates = bindings.declarations.get(name) ?? [];
  const usePosition = useNode.getStart(bindings.sourceFile);
  for (const scope of scopeChain(useNode)) {
    const visible = candidates
      .filter((binding) => binding.scope === scope)
      .filter(
        (binding) =>
          binding.position < 0 || binding.kind === 'parameter' || binding.position <= usePosition,
      )
      .sort((left, right) => right.position - left.position);
    if (visible.length === 0) continue;
    if (!visible[0].conditional) return [visible[0]];
    const reachable = [];
    for (const binding of visible) {
      reachable.push(binding);
      if (!binding.conditional) break;
    }
    return reachable;
  }
  return [];
}

function visibleBinding(name, useNode, bindings) {
  return visibleBindings(name, useNode, bindings)[0] ?? null;
}

function rawCallIdentifier(expression) {
  return ts.isIdentifier(expression) ? expression.text : null;
}

function resolveFunctionBinding(expression, useNode, bindings, seen = new Set()) {
  if (!ts.isIdentifier(expression)) return null;
  const binding = visibleBinding(expression.text, useNode, bindings);
  if (!binding || seen.has(binding)) return null;
  if (binding.kind === 'function') return binding;
  if (binding.kind === 'value' && binding.value) {
    seen.add(binding);
    return resolveFunctionBinding(binding.value, binding.node, bindings, seen);
  }
  return null;
}

function callsForFunction(functionBinding, bindings) {
  return bindings.calls.filter(
    (call) => resolveFunctionBinding(call.expression, call, bindings) === functionBinding,
  );
}

function resolveStaticStrings(node, useNode, bindings, seen = new Set()) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return resolveStaticStrings(node.expression, useNode, bindings, seen);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStaticStrings(node.left, useNode, bindings, new Set(seen));
    const right = resolveStaticStrings(node.right, useNode, bindings, new Set(seen));
    return left.flatMap((leftValue) => right.map((rightValue) => leftValue + rightValue));
  }
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const expressions = resolveStaticStrings(span.expression, useNode, bindings, new Set(seen));
      if (expressions.length === 0) return [];
      values = values.flatMap((prefix) =>
        expressions.map((expression) => prefix + expression + span.literal.text),
      );
    }
    return values;
  }
  if (ts.isIdentifier(node)) {
    const resolved = [];
    for (const binding of visibleBindings(node.text, useNode, bindings)) {
      if (seen.has(binding)) continue;
      const nextSeen = new Set(seen);
      nextSeen.add(binding);
      if (binding.kind === 'value') {
        resolved.push(...resolveStaticStrings(binding.value, binding.node, bindings, nextSeen));
      }
      if (binding.kind === 'parameter') {
        resolved.push(
          ...callsForFunction(binding.owner, bindings).flatMap((call) =>
            resolveStaticStrings(
              call.arguments[binding.parameterIndex],
              call,
              bindings,
              new Set(nextSeen),
            ),
          ),
        );
      }
    }
    return resolved;
  }
  if (ts.isCallExpression(node)) {
    const binding = resolveFunctionBinding(node.expression, node, bindings);
    if (binding && !seen.has(binding)) {
      seen.add(binding);
      return (binding.returns ?? []).flatMap((value) =>
        resolveStaticStrings(value, value, bindings, new Set(seen)),
      );
    }
  }
  return [];
}

function resolveCallableNames(expression, useNode, bindings, seen = new Set()) {
  if (ts.isPropertyAccessExpression(expression)) return [expression.name.text];
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    return resolveStaticStrings(expression.argumentExpression, expression, bindings, seen);
  }
  if (ts.isIdentifier(expression)) {
    const binding = visibleBinding(expression.text, useNode, bindings);
    if (!binding || seen.has(binding)) return [expression.text];
    seen.add(binding);
    if (binding.callableName) return [binding.callableName];
    if (binding.kind === 'value' && binding.value) {
      return resolveCallableNames(binding.value, binding.node, bindings, seen);
    }
    return [expression.text];
  }
  return [];
}

function expressionReferencesSqlAsset(node, useNode, bindings, seen = new Set()) {
  if (!node) return false;
  if (
    resolveStaticStrings(node, useNode, bindings, new Set(seen)).some((text) =>
      SQL_ASSET_PATH.test(text),
    )
  ) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    const binding = visibleBinding(node.text, useNode, bindings);
    if (!binding || seen.has(binding)) return false;
    seen.add(binding);
    if (binding.kind === 'value') {
      return expressionReferencesSqlAsset(binding.value, binding.node, bindings, seen);
    }
    if (binding.kind === 'parameter') {
      return callsForFunction(binding.owner, bindings).some((call) =>
        expressionReferencesSqlAsset(
          call.arguments[binding.parameterIndex],
          call,
          bindings,
          new Set(seen),
        ),
      );
    }
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && expressionReferencesSqlAsset(child, child, bindings, new Set(seen))) found = true;
  });
  return found;
}

function stripLeadingSqlComments(sql) {
  let remaining = sql.trimStart();
  while (remaining.startsWith('--') || remaining.startsWith('/*')) {
    if (remaining.startsWith('--')) {
      const newline = remaining.indexOf('\n');
      remaining = newline < 0 ? '' : remaining.slice(newline + 1).trimStart();
      continue;
    }
    const end = remaining.indexOf('*/', 2);
    if (end < 0) return '';
    remaining = remaining.slice(end + 2).trimStart();
  }
  return remaining;
}

function containsDdlStatement(sql) {
  return sql.split(';').some((statement) => DDL_LITERAL.test(stripLeadingSqlComments(statement)));
}

function objectSqlExpressions(objectLiteral, bindings) {
  const expressions = [];
  for (const property of objectLiteral.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      if (property.name.text === 'text' || property.name.text === 'query') {
        expressions.push(property.name);
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    let names = [];
    if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) {
      names = [property.name.text];
    } else if (ts.isComputedPropertyName(property.name)) {
      names = resolveStaticStrings(property.name.expression, property.name, bindings);
    }
    if (names.some((name) => name === 'text' || name === 'query')) {
      expressions.push(property.initializer);
    }
  }
  return expressions;
}

function expressionReferencesDdl(node, useNode, bindings, seen = new Set()) {
  if (!node) return false;
  if (
    resolveStaticStrings(node, useNode, bindings, new Set(seen)).some((text) =>
      containsDdlStatement(text),
    )
  ) {
    return true;
  }
  if (ts.isObjectLiteralExpression(node)) {
    return objectSqlExpressions(node, bindings).some((value) =>
      expressionReferencesDdl(value, value, bindings, new Set(seen)),
    );
  }
  if (ts.isIdentifier(node)) {
    const binding = visibleBinding(node.text, useNode, bindings);
    if (!binding || seen.has(binding)) return false;
    seen.add(binding);
    if (binding.kind === 'value') {
      return expressionReferencesDdl(binding.value, binding.node, bindings, seen);
    }
    if (binding.kind === 'parameter') {
      return callsForFunction(binding.owner, bindings).some((call) =>
        expressionReferencesDdl(
          call.arguments[binding.parameterIndex],
          call,
          bindings,
          new Set(seen),
        ),
      );
    }
  }
  if (ts.isCallExpression(node)) {
    const binding = resolveFunctionBinding(node.expression, node, bindings);
    if (binding && !seen.has(binding)) {
      seen.add(binding);
      return (binding.returns ?? []).some((value) =>
        expressionReferencesDdl(value, value, bindings, new Set(seen)),
      );
    }
  }
  if (ts.isConditionalExpression(node)) {
    return [node.whenTrue, node.whenFalse].some((value) =>
      expressionReferencesDdl(value, value, bindings, new Set(seen)),
    );
  }
  return false;
}

export function inspectRuntimeSource(source, path = '<source>') {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const bindings = collectBindings(sourceFile);
  const issues = new Set();

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      SQL_ASSET_PATH.test(node.moduleSpecifier.text)
    ) {
      issues.add(`${path}: imports a .sql migration asset into application runtime`);
    }

    if (ts.isCallExpression(node)) {
      const names = resolveCallableNames(node.expression, node, bindings);
      const firstArgument = node.arguments[0];
      if (
        names.some((name) => FILE_READ_NAMES.has(name)) &&
        firstArgument &&
        expressionReferencesSqlAsset(firstArgument, firstArgument, bindings)
      ) {
        issues.add(`${path}: loads a .sql migration file at application runtime`);
      }
      if (
        (names.includes('require') || node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        firstArgument &&
        expressionReferencesSqlAsset(firstArgument, firstArgument, bindings)
      ) {
        issues.add(`${path}: imports a .sql migration asset into application runtime`);
      }
      if (
        names.some((name) => DATABASE_EXECUTION_NAMES.has(name)) &&
        firstArgument &&
        expressionReferencesDdl(firstArgument, firstArgument, bindings)
      ) {
        issues.add(`${path}: sends DDL through an application database client`);
      }
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const names = resolveCallableNames(node.tag, node, bindings);
      if (
        names.some((name) => name === 'sql' || DATABASE_EXECUTION_NAMES.has(name)) &&
        expressionReferencesDdl(node.template, node.template, bindings)
      ) {
        issues.add(`${path}: sends tagged-template DDL through an application database client`);
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...issues];
}

function isRuntimeSource(root, path) {
  const rel = relative(root, path).split(sep).join('/');
  if (!SOURCE_EXTENSIONS.has(extname(path))) return false;
  if (TEST_FILE.test(rel) || rel.includes('/__tests__/')) return false;
  if (rel.startsWith('packages/shared/testing/')) return false;
  return /^(?:apps|packages)\/.+\/src\//.test(rel);
}

function collectFiles(root, directory, files) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(root, path, files);
    else if (entry.isFile() && isRuntimeSource(root, path)) files.push(path);
  }
}

export function evaluateRuntimeSchemaVersion(root) {
  const sqlDir = join(root, 'db/sql');
  const readinessPath = join(root, 'packages/shared/database/src/schema-readiness.ts');
  if (!existsSync(sqlDir) || !existsSync(readinessPath)) return [];

  const migrations = readdirSync(sqlDir)
    .filter((name) => /^[0-9].*\.sql$/.test(name))
    .filter((name) => !/^[0-9]+b_.*_seed\.sql$/.test(name))
    .sort();
  const latest = migrations.at(-1);
  const source = readFileSync(readinessPath, 'utf8');
  const declared = source.match(/CURRENT_RUNTIME_SCHEMA_MIGRATION\s*=\s*['"]([^'"]+)['"]/)?.[1];

  if (!latest) return ['db/sql has no numbered non-seed migrations'];
  if (declared !== latest) {
    return [
      `runtime schema marker is ${declared ?? 'missing'}; latest non-seed migration is ${latest}`,
    ];
  }
  return [];
}

export function evaluateNoRuntimeDdl(root) {
  const files = [];
  collectFiles(root, join(root, 'apps'), files);
  collectFiles(root, join(root, 'packages'), files);

  const issues = [];
  for (const path of files.sort()) {
    const rel = relative(root, path).split(sep).join('/');
    issues.push(...inspectRuntimeSource(readFileSync(path, 'utf8'), rel));
  }
  issues.push(...evaluateRuntimeSchemaVersion(root));
  return { ok: issues.length === 0, issues, filesScanned: files.length };
}

function parseRoot(argv) {
  const flag = argv.find((value) => value.startsWith('--root='));
  return flag
    ? resolve(flag.slice('--root='.length))
    : join(dirname(fileURLToPath(import.meta.url)), '../..');
}

function main() {
  const report = evaluateNoRuntimeDdl(parseRoot(process.argv.slice(2)));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`check-no-runtime-ddl: PASS (${report.filesScanned} runtime source files scanned)`);
  } else {
    console.error('check-no-runtime-ddl: FAIL');
    for (const issue of report.issues) console.error(`  - ${issue}`);
  }
  process.exit(report.ok ? 0 : 1);
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) main();
