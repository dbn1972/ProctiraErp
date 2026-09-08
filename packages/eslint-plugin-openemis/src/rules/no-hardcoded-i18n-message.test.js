'use strict';

const { RuleTester } = require('eslint');
const rule = require('./no-hardcoded-i18n-message');

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-hardcoded-i18n-message', rule, {
  valid: [
    { code: `const o = { message: 'error.invalid_input' };` },
    { code: `const o = { message: 'VALIDATION_ERROR' };` },
    { code: `const o = { message: 'created' };` },
    { code: `const o = { message: 'short' };` },
    // Template literals are ignored — they typically wrap a t() call already
    { code: "const o = { message: `${t('error.x')}` };" },
    // Non-message keys are not constrained by this rule
    { code: `const o = { description: 'A long human-readable string here.' };` },
  ],
  invalid: [
    {
      code: `const o = { message: 'The student record could not be located in the database.' };`,
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: `const o = { 'message': 'Account is temporarily locked due to too many failed attempts.' };`,
      errors: [{ messageId: 'hardcoded' }],
    },
  ],
});

console.log('✅ no-hardcoded-i18n-message rule tests passed');
