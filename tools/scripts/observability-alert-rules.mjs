/**
 * PRC-L187: structural alert-rule check for validate-observability.mjs.
 *
 * Takes a parsed Prometheus rules document (js-yaml output) and returns the
 * failures for the expected alert names. A name only counts when it is a real
 * `alert:` rule with a non-empty `expr` and `for`; a commented-out rule or a
 * name mentioned in a comment/annotation no longer satisfies the check.
 *
 * @param {unknown} doc parsed YAML
 * @param {string[]} expected alert names that must be present
 * @returns {string[]} failure messages (empty when OK)
 */
export function checkAlertRules(doc, expected) {
  const failures = [];
  const groups = doc && typeof doc === 'object' && Array.isArray(doc.groups) ? doc.groups : null;
  if (!groups) return ['rules file has no `groups:` list'];
  const rules = new Map();
  for (const group of groups) {
    for (const rule of Array.isArray(group?.rules) ? group.rules : []) {
      if (typeof rule?.alert !== 'string') continue;
      if (rules.has(rule.alert)) failures.push(`duplicate alert rule ${rule.alert}`);
      rules.set(rule.alert, rule);
    }
  }
  for (const name of expected) {
    const rule = rules.get(name);
    if (!rule) {
      failures.push(`missing rule ${name}`);
      continue;
    }
    const expr = typeof rule.expr === 'string' ? rule.expr.trim() : rule.expr;
    if (expr === undefined || expr === null || expr === '') {
      failures.push(`rule ${name} has no expr`);
    }
    if (typeof rule.for !== 'string' || rule.for.trim() === '') {
      failures.push(`rule ${name} has no for duration`);
    }
  }
  return failures;
}
