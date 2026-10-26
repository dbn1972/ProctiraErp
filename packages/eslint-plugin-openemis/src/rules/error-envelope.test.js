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
    // PRC-L301: const payload resolved to a compliant object literal
    {
      code: `const body = { code: 'C', message: 'm', statusCode: 400 }; reply.status(400).send(body);`,
    },
    // PRC-L301: reassignable bindings stay presumed compliant
    {
      code: `let body = { message: 'x' }; body = make(); reply.status(400).send(body);`,
    },
    // PRC-L301: parameters are not resolved
    {
      code: `function f(status) { reply.status(status).send({ message: 'x' }); }`,
    },
    // PRC-L301: const status resolved to a 2xx code is not constrained
    {
      code: `const s = 200; reply.status(s).send({ data: 1 });`,
    },
    // PRC-L301: a const payload mutated after declaration is presumed compliant
    {
      code: `const body = { message: 'x' }; body.code = 'C'; body.statusCode = 400; reply.status(400).send(body);`,
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
    // PRC-L301: const status identifier
    {
      code: `const s = 400; reply.status(s).send({ message: 'x' });`,
      errors: [
        { messageId: 'missingFields', data: { status: '400', missing: 'code, statusCode' } },
      ],
    },
    // PRC-L301: const payload identifier
    {
      code: `const body = { message: 'x' }; reply.status(404).send(body);`,
      errors: [
        { messageId: 'missingFields', data: { status: '404', missing: 'code, statusCode' } },
      ],
    },
    // PRC-L301: both resolved
    {
      code: `const s = 500; const body = { code: 'X' }; reply.code(s).send(body);`,
      errors: [
        { messageId: 'missingFields', data: { status: '500', missing: 'message, statusCode' } },
      ],
    },
  ],
});

console.log('✅ error-envelope rule tests passed');
