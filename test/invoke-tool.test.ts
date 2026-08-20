import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { invokeTool } from '../src/tools/invoke-tool.js';
import type { GeneratedTool } from '../src/openapi/types.js';

async function withMockServer(
  handler: (req: import('node:http').IncomingMessage, body: string) => Promise<void> | void,
  run: (origin: string) => Promise<void>,
) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => {
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', async () => {
      await handler(req, Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to get mock server address');
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

test('invokeTool injects auth and connection defaults', async () => {
  const tool: GeneratedTool = {
    name: 'post_sessions',
    title: 'Create session',
    description: 'Create session',
    authRequirement: 'firebaseToken',
    operation: {
      sourcePath: 'test',
      specTitle: 'test',
      path: '/api/v1/sessions',
      method: 'post',
      document: {},
      operation: {
        security: [{ firebaseBearerAuth: [] }],
      },
    },
    parameters: [],
    requestBodySchema: {
      type: 'object',
      properties: {
        workspaceName: { type: 'string' },
      },
    },
    responseSchema: undefined,
  };

  await withMockServer((req, body) => {
    assert.equal(req.url, '/api/v1/sessions');
    assert.equal(req.headers.authorization, 'Bearer firebase-token');
    assert.deepEqual(JSON.parse(body), {
      workspaceName: 'demo-workspace',
      payload: { hello: 'world' },
    });
  }, async origin => {
    const result = await invokeTool(tool, {
      connection: {
        host: origin,
        workspaceName: 'demo-workspace',
      },
      auth: {
        firebaseToken: 'firebase-token',
      },
      body: {
        payload: { hello: 'world' },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  });
});

test('invokeTool encodes path and query parameters', async () => {
  const tool: GeneratedTool = {
    name: 'auth_session_callback',
    title: 'Hosted login callback',
    description: 'Hosted login callback',
    authRequirement: null,
    operation: {
      sourcePath: 'test',
      specTitle: 'test',
      path: '/api/v1/auth/callback',
      method: 'get',
      document: {},
      operation: {},
    },
    parameters: [
      {
        name: 'firebaseToken',
        location: 'query',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'client_redirect_uri',
        location: 'query',
        required: true,
        schema: { type: 'string' },
      },
    ],
    requestBodySchema: undefined,
    responseSchema: undefined,
  };

  await withMockServer(req => {
    assert.match(
      req.url ?? '',
      /^\/api\/v1\/auth\/callback\?firebaseToken=abc&client_redirect_uri=http%3A%2F%2Fexample.com&workspace_name=demo&app_id=test-app$/,
    );
  }, async origin => {
    await invokeTool(tool, {
      connection: {
        host: origin,
        workspaceName: 'demo',
        appId: 'test-app',
      },
      query: {
        firebaseToken: 'abc',
        client_redirect_uri: 'http://example.com',
      },
    });
  });
});

test('invokeTool calls docs search without auth', async () => {
  const tool: GeneratedTool = {
    name: 'get_docs_search',
    title: 'Semantic documentation search',
    description: 'Search public docs',
    authRequirement: null,
    operation: {
      sourcePath: 'test',
      specTitle: 'test',
      path: '/api/v1/docs/search',
      method: 'get',
      document: {},
      operation: {},
    },
    parameters: [
      {
        name: 'q',
        location: 'query',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        location: 'query',
        required: false,
        schema: { type: 'integer' },
      },
    ],
    requestBodySchema: undefined,
    responseSchema: undefined,
  };

  await withMockServer(req => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.url, '/api/v1/docs/search?q=hosted+login&limit=5');
  }, async origin => {
    await invokeTool(tool, {
      connection: { host: origin },
      query: { q: 'hosted login', limit: 5 },
    });
  });
});
