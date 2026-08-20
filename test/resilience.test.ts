/**
 * Resilience: a single bad request / tool validation throw / process-level
 * uncaughtException must not take down the HTTP listener.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createMcpApp } from '../src/server.js';
import { installProcessGuards } from '../src/process-guards.js';

function textFromToolContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (c): c is { type: 'text'; text: string } =>
        typeof c === 'object' &&
        c !== null &&
        'type' in c &&
        (c as { type: string }).type === 'text' &&
        'text' in c &&
        typeof (c as { text: unknown }).text === 'string',
    )
    .map(c => c.text)
    .join('\n');
}

async function withListeningApp(run: (origin: string) => Promise<void>): Promise<void> {
  process.env.HOST = '127.0.0.1';
  process.env.ALLOWED_HOSTS = '127.0.0.1,localhost';

  const { app } = await createMcpApp();
  const httpServer = createServer(app);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
    httpServer.on('error', reject);
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve ephemeral listen port');
  }
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    await run(origin);
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close(error => (error ? reject(error) : resolve()));
    });
  }
}

test('malformed POST /mcp leaves /health available', async () => {
  await withListeningApp(async origin => {
    const bad = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: {}, id: 1 }),
    });
    assert.ok(bad.status >= 200, `unexpected status ${bad.status}`);
    await bad.text();

    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
  });
});

test('static tool validation failures return isError and leave /health up', async () => {
  await withListeningApp(async origin => {
    const client = new Client({ name: 'mcp-resilience', version: '0.0.0-test' });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: 'secureflows_build_login_url',
        arguments: {
          workspaceName: 'ws',
          appId: 'app',
          redirectUri: 'https://example.com/callback',
          intent: 'fresh_login',
          expiredToken: 'dead-jwt',
        },
      });
      assert.equal(result.isError, true);
      const text = textFromToolContent(result.content);
      assert.match(text, /expiredToken must not be set/);
    } finally {
      await client.close();
      await transport.close();
    }

    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
  });
});

test('installProcessGuards logs uncaughtException without throwing', () => {
  const logs: string[] = [];
  const beforeUncaught = process.listenerCount('uncaughtException');
  const beforeRejection = process.listenerCount('unhandledRejection');

  installProcessGuards((message, error) => {
    logs.push(`${message}:${error instanceof Error ? error.message : String(error)}`);
  });

  assert.ok(process.listenerCount('uncaughtException') > beforeUncaught);
  assert.ok(process.listenerCount('unhandledRejection') > beforeRejection);

  const uncaught = process.listeners('uncaughtException').at(-1);
  const rejection = process.listeners('unhandledRejection').at(-1);
  assert.equal(typeof uncaught, 'function');
  assert.equal(typeof rejection, 'function');

  uncaught!(new Error('synthetic-uncaught'), 'uncaughtException');
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /synthetic-uncaught/);

  process.removeListener('uncaughtException', uncaught!);
  process.removeListener('unhandledRejection', rejection!);
});
