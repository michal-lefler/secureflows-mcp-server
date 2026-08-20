import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export interface ServerConfig {
  port: number;
  host: string;
  allowedHosts?: string[];
  specPaths: string[];
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function envCsv(name: string): string[] | undefined {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const values = raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

// Walks up from `startDir` to the nearest ancestor containing a package.json — i.e. this
// package's root. A fixed hop count (`../..`) only matches one layout: it's two levels from
// `dist/src/config.js` but just one from `src/config.ts`, so anything that imports the source
// directly (tsx dev/test runs) would land one directory too high.
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

function defaultSpecPaths(): string[] {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = findPackageRoot(thisDir);
  const repoRoot = path.resolve(packageRoot, '..');
  const packageLocal = [
    path.join(packageRoot, 'docs', 'openapi', 'session', 'secure-flows-session-api.yaml'),
    path.join(packageRoot, 'docs', 'openapi', 'user', 'secure-flows-user-api.yaml'),
    path.join(packageRoot, 'docs', 'openapi', 'docs', 'secure-flows-docs-api.yaml'),
  ];
  const repoLocal = [
    path.join(repoRoot, 'docs', 'openapi', 'session', 'secure-flows-session-api.yaml'),
    path.join(repoRoot, 'docs', 'openapi', 'user', 'secure-flows-user-api.yaml'),
    path.join(repoRoot, 'docs', 'openapi', 'docs', 'secure-flows-docs-api.yaml'),
  ];

  if (packageLocal.every(specPath => existsSync(specPath))) {
    return packageLocal;
  }

  return repoLocal;
}

export function loadConfig(): ServerConfig {
  return {
    port: envNumber('PORT', 8787),
    host: process.env.HOST ?? '0.0.0.0',
    allowedHosts: envCsv('ALLOWED_HOSTS'),
    specPaths: defaultSpecPaths(),
  };
}
