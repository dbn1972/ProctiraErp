#!/usr/bin/env node
/**
 * PRC-M256: GitHub expression values must not be interpolated into `run:` script text.
 *
 * `${{ inputs.* }}`, `${{ github.event.* }}`, `${{ github.head_ref }}`,
 * `${{ needs.*.outputs.* }}` and `${{ matrix.* }}` are (or can carry) caller-controlled
 * strings; expanded inline they become shell code in jobs that hold deploy secrets. Pass them
 * through step `env:` and reference "$VAR" instead.
 *
 * Run: node tools/scripts/check-workflow-script-injection.mjs [files...]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNSAFE_EXPRESSION =
  /\$\{\{\s*(inputs\.|github\.event\.|github\.head_ref\b|needs\.[\w-]+\.outputs\.|matrix\.)/;

const RUN_KEY = /^(\s*)(?:-\s+)?run:\s*(.*)$/;
const NAME_KEY = /^\s*(?:-\s+)?name:\s*(.+?)\s*$/;
const JOB_KEY = /^ {2}([\w-]+):\s*$/;

/**
 * Dependency-free scan (the lint job has no node_modules): collect every `run:` value, inline
 * or block scalar (lines indented deeper than the `run:` key), and test it for unsafe
 * expressions. `env:` / `with:` / `if:` values are never `run:` text, so they are allowed.
 *
 * @returns {Array<{ job: string, step: string, expression: string, line: number }>}
 */
export function findScriptInjections(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const findings = [];
  let job = '(composite)';
  let stepName = '(unnamed)';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const jobMatch = JOB_KEY.exec(line);
    if (jobMatch) job = jobMatch[1];
    if (/^\s*-\s+/.test(line)) stepName = '(unnamed)';
    const nameMatch = NAME_KEY.exec(line);
    if (nameMatch) stepName = nameMatch[1].replace(/^['"]|['"]$/g, '');
    const runMatch = RUN_KEY.exec(line);
    if (!runMatch) continue;
    const keyIndent = line.indexOf('run:');
    let script = /^[|>]/.test(runMatch[2]) ? '' : runMatch[2];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.trim() === '') continue;
      if (next.search(/\S/) <= keyIndent) break;
      script += `\n${next}`;
    }
    const match = script.match(UNSAFE_EXPRESSION);
    if (match) findings.push({ job, step: stepName, expression: match[0], line: i + 1 });
    i = j - 1;
  }
  return findings;
}

function defaultFiles(root) {
  const files = [];
  const wf = join(root, '.github/workflows');
  for (const name of readdirSync(wf)) {
    if (/\.ya?ml$/.test(name)) files.push(join(wf, name));
  }
  const actions = join(root, '.github/actions');
  if (existsSync(actions)) {
    for (const dir of readdirSync(actions)) {
      for (const name of ['action.yml', 'action.yaml']) {
        const p = join(actions, dir, name);
        if (existsSync(p)) files.push(p);
      }
    }
  }
  return files;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const files = process.argv.length > 2 ? process.argv.slice(2) : defaultFiles(root);
  let total = 0;
  for (const file of files) {
    for (const f of findScriptInjections(readFileSync(file, 'utf8'))) {
      total += 1;
      console.error(
        `${relative(root, file)}:${f.line}: job "${f.job}" step "${f.step}" inlines ${f.expression}…}}`,
      );
    }
  }
  if (total > 0) {
    console.error(
      `PRC-M256: ${total} run: block(s) interpolate untrusted expressions; move them to step env: and use "$VAR".`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `PRC-M256: ${files.length} workflow/action file(s) scanned; no inline untrusted expressions in run: blocks.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
