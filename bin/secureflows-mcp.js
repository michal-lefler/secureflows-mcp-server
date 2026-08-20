#!/usr/bin/env node
import { startServer } from '../dist/src/server.js';

startServer().catch(error => {
  console.error('Failed to start secureFlows MCP server:', error);
  process.exit(1);
});
