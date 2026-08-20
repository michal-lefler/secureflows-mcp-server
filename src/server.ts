import { createServer, type Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Express, NextFunction, Request, Response } from 'express';

import { loadConfig, type ServerConfig } from './config.js';
import { loadSpecs } from './openapi/load-spec.js';
import { installProcessGuards } from './process-guards.js';
import { buildGeneratedTools, registerGeneratedTools } from './tools/build-tools.js';
import { registerStaticTools, STATIC_TOOL_COUNT } from './tools/static-tools.js';

/**
 * Version reported to MCP clients on connect. Read from package.json rather than hardcoded — a
 * literal here silently drifts on every release (it was still '0.1.0' one release later), and a
 * server that misreports its own version makes client-side version-gating unreliable.
 *
 * dist layout is dist/src/server.js, so package.json is two levels up from this file at runtime
 * and from src/ during `tsx` dev — resolve from import.meta.url either way rather than cwd.
 */
function readPackageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.resolve(here, '..', 'package.json'),
    path.resolve(here, '..', '..', 'package.json'),
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'secureflows-mcp-server' && pkg.version) {
        return pkg.version;
      }
    } catch {
      // Try the next candidate — a missing/unreadable file here is not fatal.
    }
  }
  return '0.0.0-unknown';
}

const SERVER_VERSION = readPackageVersion();

async function buildServerFactory() {
  const config = loadConfig();
  const specs = await loadSpecs(config.specPaths);
  const generatedTools = buildGeneratedTools(specs);

  console.log(
    `Loaded ${generatedTools.length} generated MCP tools from ${specs.length} OpenAPI specs, ` +
      `plus ${STATIC_TOOL_COUNT} hand-written static tools.`,
  );

  const createToolServer = () => {
    const server = new McpServer(
      {
        name: 'secureflows-mcp-server',
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          logging: {},
        },
      },
    );

    registerGeneratedTools(server, generatedTools);
    registerStaticTools(server);

    return server;
  };

  return {
    config,
    createToolServer,
    generatedToolCount: generatedTools.length,
  };
}

/**
 * Builds the Express app (health + /mcp) without listening. Used by {@link startServer} and
 * HTTP smoke tests.
 */
export async function createMcpApp(): Promise<{
  app: Express;
  config: ServerConfig;
  generatedToolCount: number;
}> {
  const { config, createToolServer, generatedToolCount } = await buildServerFactory();
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/mcp', async (req, res) => {
    const server = createToolServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    } finally {
      // Close failures must not become unhandled rejections that take down the process.
      try {
        await transport.close();
      } catch (error) {
        console.error('Error closing MCP transport:', error);
      }
      try {
        await server.close();
      } catch (error) {
        console.error('Error closing MCP server:', error);
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Use POST /mcp.',
      },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Use POST /mcp.',
      },
      id: null,
    });
  });

  // Last-resort Express error middleware — keeps a single bad request from becoming an
  // uncaught exception that Node would otherwise treat as fatal.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled Express error:', error);
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error',
      },
      id: null,
    });
  });

  return { app, config, generatedToolCount };
}

export async function startServer(): Promise<HttpServer> {
  installProcessGuards();

  const { app, config } = await createMcpApp();
  const httpServer = createServer(app);

  // Malformed clients / abrupt disconnects — log only; do not exit.
  httpServer.on('clientError', (error, socket) => {
    console.error('HTTP clientError:', error.message);
    if (!socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, config.host, () => resolve());
    httpServer.on('error', reject);
  });

  // After listen succeeds, further 'error' events (rare) must not crash the process as an
  // uncaughtException — the listen Promise already settled.
  httpServer.on('error', error => {
    console.error('HTTP server error after listen:', error);
  });

  console.log(`secureFlows MCP server listening on http://${config.host}:${config.port}`);
  if (config.allowedHosts?.length) {
    console.log(`Allowed hosts: ${config.allowedHosts.join(', ')}`);
  }

  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close(error => (error ? reject(error) : resolve()));
    });
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  return httpServer;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  startServer().catch(error => {
    console.error('Failed to start secureFlows MCP server:', error);
    process.exit(1);
  });
}
