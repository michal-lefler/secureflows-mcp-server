import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSpecs } from '../src/openapi/load-spec.js';
import { buildGeneratedTools } from '../src/tools/build-tools.js';

// Resolved relative to this file, not hardcoded to a specific machine's home directory — a
// hardcoded absolute path here only ever worked by coincidence on whichever machine it was
// written on and breaks on any other checkout, including every CI runner.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specPaths = [
  path.join(packageRoot, 'docs', 'openapi', 'session', 'secure-flows-session-api.yaml'),
  path.join(packageRoot, 'docs', 'openapi', 'user', 'secure-flows-user-api.yaml'),
  path.join(packageRoot, 'docs', 'openapi', 'docs', 'secure-flows-docs-api.yaml'),
];

test('buildGeneratedTools keeps only ai-safe and ai-optional operations', async () => {
  const specs = await loadSpecs(specPaths);
  const tools = buildGeneratedTools(specs);
  const names = new Set(tools.map(tool => tool.name));

  assert.ok(names.has('post_sessions'));
  assert.ok(names.has('auth_session_callback'));
  assert.ok(names.has('post_sessions_revoke'));
  assert.ok(names.has('post_sessions_revoke_session_id'));
  assert.ok(names.has('get_docs_search'));
  assert.ok(!names.has('get_sessions_admin'));
});
