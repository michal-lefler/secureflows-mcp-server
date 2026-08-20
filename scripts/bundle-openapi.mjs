// Copies the source-of-truth docs/openapi/{session,user,docs} specs into mcp-server/docs/openapi so
// they ship inside the published npm package. Without this, an npx/global install of this
// package has no monorepo checkout next to it and config.ts's defaultSpecPaths() (which checks
// <packageRoot>/docs/openapi first, falling back to <repoRoot>/docs/openapi) would find nothing.
// Runs via the "prepack" npm lifecycle hook, so both `npm pack` (local, no registry) and a real
// `npm publish` always ship a self-contained, up-to-date bundle — never a stale one committed by
// hand.
//
// This repo is a public mirror of the private secureFlows monorepo, which is where these specs
// actually get edited. There is no repoRoot/docs/openapi here — mcp-server/docs/openapi is
// committed directly instead, kept current by the monorepo's sync script. If that committed
// copy is present, skip re-copying rather than failing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..');

const specs = [
  ['docs/openapi/session/secure-flows-session-api.yaml', 'docs/openapi/session/secure-flows-session-api.yaml'],
  ['docs/openapi/user/secure-flows-user-api.yaml', 'docs/openapi/user/secure-flows-user-api.yaml'],
  ['docs/openapi/docs/secure-flows-docs-api.yaml', 'docs/openapi/docs/secure-flows-docs-api.yaml'],
];

for (const [srcRel, destRel] of specs) {
  const src = path.join(repoRoot, srcRel);
  const dest = path.join(packageRoot, destRel);
  if (!fs.existsSync(src)) {
    if (fs.existsSync(dest)) {
      console.log(`bundle-openapi: no monorepo checkout at ${src}, keeping committed ${destRel}`);
      continue;
    }
    console.error(`bundle-openapi: missing source spec ${srcRel} (expected at ${src})`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`bundle-openapi: ${srcRel} -> mcp-server/${destRel}`);
}
