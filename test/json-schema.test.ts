import test from 'node:test';
import assert from 'node:assert/strict';

import { jsonSchemaToZod } from '../src/tools/json-schema.js';

test('jsonSchemaToZod supports nested objects and required properties', () => {
  const schema = jsonSchemaToZod({
    type: 'object',
    required: ['workspaceName'],
    properties: {
      workspaceName: { type: 'string' },
      payload: {
        type: 'object',
        additionalProperties: true,
      },
    },
  });

  const valid = schema.safeParse({
    workspaceName: 'demo',
    payload: { hello: 'world' },
  });
  const invalid = schema.safeParse({
    payload: { hello: 'world' },
  });

  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});

test('jsonSchemaToZod supports oneOf unions', () => {
  const schema = jsonSchemaToZod({
    oneOf: [{ type: 'string' }, { type: 'integer' }],
  });

  assert.equal(schema.safeParse('hello').success, true);
  assert.equal(schema.safeParse(42).success, true);
  assert.equal(schema.safeParse(false).success, false);
});
