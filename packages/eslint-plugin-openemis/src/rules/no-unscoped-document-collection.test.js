'use strict';

const { RuleTester } = require('eslint');
const rule = require('./no-unscoped-document-collection');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const classWith = (body) => `
import { PgDocumentCollection } from '@proctira/database';
class Repo {
  private readonly docs: PgDocumentCollection<{ id: string }>;
  constructor(pool: unknown) {
    this.docs = new PgDocumentCollection(pool, 'x.docs');
  }
  async run(tenantId: string) {
    ${body}
  }
}`;

ruleTester.run('no-unscoped-document-collection', rule, {
  valid: [
    { code: classWith(`await this.docs.put('a', { id: 'a' }, tenantId);`) },
    { code: classWith(`await this.docs.put('a', { id: 'a' }, null);`) },
    { code: classWith(`await this.docs.insertIfAbsent('a', { id: 'a' }, tenantId);`) },
    { code: classWith(`await this.docs.where({ id: 'a' }, tenantId);`) },
    { code: classWith(`await this.docs.first({ id: 'a' }, null);`) },
    { code: classWith(`await this.docs.get('a', { tenantId });`) },
    { code: classWith(`await this.docs.all({ platform: true });`) },
    // Other receivers named like collection methods are not touched.
    { code: classWith(`const m = new Map(); m.get('a'); this.cache?.delete('a');`) },
    { code: `const fastify = app(); fastify.put('/x', handler);` },
    // Constructor parameter property typed as a collection, fully scoped.
    {
      code: `class S { constructor(private readonly docs: PgDocumentCollection<{ id: string }>) {}
        save(t: string) { return this.docs.put('a', { id: 'a' }, t); } }`,
    },
    // Spread arguments cannot be counted statically; left to the type checker.
    { code: classWith(`await this.docs.put(...args);`) },
  ],
  invalid: [
    {
      code: classWith(`await this.docs.put('a', { id: 'a' });`),
      errors: [{ messageId: 'unscoped', data: { method: 'put' } }],
    },
    {
      code: classWith(`await this.docs.insertIfAbsent('a', { id: 'a' });`),
      errors: [{ messageId: 'unscoped', data: { method: 'insertIfAbsent' } }],
    },
    {
      code: classWith(`await this.docs.where({ id: 'a' });`),
      errors: [{ messageId: 'unscoped', data: { method: 'where' } }],
    },
    {
      code: classWith(`await this.docs.first({ id: 'a' });`),
      errors: [{ messageId: 'unscoped', data: { method: 'first' } }],
    },
    {
      code: `const docs = new PgDocumentCollection(pool, 'x'); docs.put('a', {});`,
      errors: [{ messageId: 'unscoped', data: { method: 'put' } }],
    },
    {
      code: `class S { constructor(private readonly docs: PgDocumentCollection<{ id: string }>) {}
        find() { return this.docs.first({ id: 'a' }); } }`,
      errors: [{ messageId: 'unscoped', data: { method: 'first' } }],
    },
    {
      code: `class S { private docs = new PgDocumentCollection(pool, 'x');
        save() { return this.docs.put('a', {}); } }`,
      errors: [{ messageId: 'unscoped', data: { method: 'put' } }],
    },
  ],
});

console.log('✅ no-unscoped-document-collection rule tests passed');
