/**
 * HTTP-level smoke for the MCP Express app: health, method guards, and a real
 * Streamable-HTTP client round-trip (listTools + callTool on a static tool).
 *
 * Complements unit tests of static-tool helpers / OpenAPI selection — those never
 * open a port or exercise createMcpExpressApp + transport.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createMcpApp } from '../src/server.js';
import { STATIC_TOOL_COUNT } from '../src/tools/static-tools.js';

const STATIC_TOOL_NAMES = [
  'secureflows_build_login_url',
  'secureflows_build_logout_url',
  'secureflows_lint_integration',
] as const;

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

async function withListeningApp(
  run: (origin: string, generatedToolCount: number) => Promise<void>,
): Promise<void> {
  // Host allowlist must include the Host header fetch sends (127.0.0.1).
  process.env.HOST = '127.0.0.1';
  process.env.ALLOWED_HOSTS = '127.0.0.1,localhost';

  const { app, generatedToolCount } = await createMcpApp();
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
    await run(origin, generatedToolCount);
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close(error => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /health returns ok', async () => {
  await withListeningApp(async origin => {
    const res = await fetch(`${origin}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('GET /mcp is method-not-allowed', async () => {
  await withListeningApp(async origin => {
    const res = await fetch(`${origin}/mcp`);
    assert.equal(res.status, 405);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.match(body.error?.message ?? '', /POST \/mcp/);
  });
});

test('Streamable HTTP client lists static tools and can call build_login_url', async () => {
  await withListeningApp(async (origin, generatedToolCount) => {
    assert.ok(generatedToolCount > 0, 'expected OpenAPI-generated tools to load');

    const client = new Client({ name: 'mcp-http-smoke', version: '0.0.0-test' });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
    await client.connect(transport);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map(t => t.name);

      for (const name of STATIC_TOOL_NAMES) {
        assert.ok(names.includes(name), `missing static tool ${name}; got: ${names.join(', ')}`);
      }
      assert.ok(
        names.length >= STATIC_TOOL_COUNT + generatedToolCount,
        `expected at least ${STATIC_TOOL_COUNT} static + ${generatedToolCount} generated tools, got ${names.length}`,
      );

      const result = await client.callTool({
        name: 'secureflows_build_login_url',
        arguments: {
          workspaceName: 'smoke-ws',
          appId: 'smoke-app',
          redirectUri: 'https://example.com/callback',
        },
      });

      assert.equal(result.isError, undefined);
      const text = textFromToolContent(result.content);
      assert.ok(text, 'expected text content from build_login_url');
      assert.match(text, /\/app\/sessions\/login/);
      assert.doesNotMatch(text, /\/app\/login\?/);
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
