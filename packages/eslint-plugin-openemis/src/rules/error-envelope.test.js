'use strict';

const { RuleTester } = require('eslint');
const rule = require('./error-envelope');

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('error-envelope', rule, {
  valid: [
    // Compliant 4xx envelope
    {
      code: `reply.status(400).send({ code: 'VAL', message: 'failed', statusCode: 400 });`,
    },
    // Compliant 5xx envelope with extra fields
    {
      code: `reply.status(500).send({ code: 'X', message: 'oops', statusCode: 500, errors: [] });`,
    },
    // 2xx success envelopes are not constrained by this rule
    {
      code: `reply.status(200).send({ data: 'ok' });`,
    },
    // Spread is presumed compliant
    {
      code: `reply.status(400).send({ ...errorEnvelope });`,
    },
    // Re-thrown errors inside catch are allowed
    {
      code: `try { doStuff(); } catch (e) { throw new Error('boom'); }`,
    },
    // status alias `code` works the same
    {
      code: `reply.code(403).send({ code: 'F', message: 'no', statusCode: 403 });`,
    },
  ],
  invalid: [
    {
      code: `reply.status(400).send({ message: 'failed', statusCode: 400 });`,
      errors: [{ messageId: 'missingFields', data: { status: '400', missing: 'code' } }],
    },
    {
      code: `reply.status(404).send({ statusCode: 404 });`,
      errors: [{ messageId: 'missingFields' }],
    },
    {
      code: `throw new Error('not in catch');`,
      errors: [{ messageId: 'rawError' }],
    },
  ],
});

console.log('✅ error-envelope rule tests passed');
