# secureFlows MCP Server

[![secureFlows](https://img.shields.io/badge/secureFlows-www.secure--flows.com-1a73e8)](https://www.secure-flows.com)

> This repo is a public mirror, published periodically from the private secureFlows monorepo
> where development actually happens. Issues and PRs are welcome; large changes may take a
> release cycle to land upstream first.

Cloud-deployable MCP server that wraps the [secureFlows](https://www.secure-flows.com) OpenAPI
surface tagged `ai-safe` and `ai-optional`.

## What is an MCP server?

An **MCP server** is a small HTTP service that exposes a set of “tools” an AI client can call in a standard way.

In this repo:
- The **secureFlows MCP server** exposes tools that are auto-generated from your OpenAPI YAML specs.
- When a client calls a tool, the MCP server **forwards** the call to your real secureFlows backend (`connection.host`)
  and returns the response in a normalized tool result.

This lets an AI client:
- discover available secureFlows operations via `listTools`
- call them via `callTool`
- without hardcoding the API surface or manual auth/header wiring

## What it does

Two kinds of tools, registered together in `src/server.ts`:

**Generated tools** (`src/tools/build-tools.ts`) — one per OpenAPI operation:
- Loads:
  - `docs/openapi/session/secure-flows-session-api.yaml`
  - `docs/openapi/user/secure-flows-user-api.yaml`
  - `docs/openapi/docs/secure-flows-docs-api.yaml`
- Exposes only operations tagged `ai-safe` or `ai-optional` as MCP tools
- Forwards requests to a caller-provided secureFlows host — a thin, generic HTTP wrapper with no
  secureFlows-specific judgment. Every one of these requires a live `auth.*` token, so they're
  only useful once a session already exists (see **Runtime model** below).
- Maps secureFlows auth headers from MCP tool inputs:
  - `auth.firebaseToken`
  - `auth.sessionToken`
  - `auth.userToken`

**Static tools** (`src/tools/static-tools.ts`) — hand-written, not generated from the spec:
- `secureflows_build_login_url` / `secureflows_build_logout_url` — build the hosted-login and
  redirect-logout URLs correctly by construction (always `/app/sessions/login`, never the legacy
  `/app/login`; refuses a post-logout `redirect_uri` that points at `/callback` or leaks
  `session_token`). No secureFlows token required.
- `secureflows_lint_integration` — checks generated app source against the integration rules and
  reports structured findings instead of leaving them as prose the agent has to self-police. No
  secureFlows token required. Two kinds of finding:
  - **`scope: "file"`** — a forbidden construct is *present*, at an exact `file:line`: env-var
    config constants, token in `localStorage`, legacy `/app/login`, `fetch`/XHR logout, client-side
    JWT decode, revoke-on-sign-out, empty `catch {}`, restore `setSession(null)` on non-auth errors,
    Continue CTA gated on `session === null`, …
  - **`scope: "project"`** — required handling is *absent* across every file passed in: detecting
    `401`/`410` but never clearing the token, never handling `403`, or handling `403` without the
    `BILLING_GRACE_LOCK` carve-out.

  The absence checks exist because the pattern rules structurally could not catch the defect class
  that dominates real generated apps. Measured: on a real trial's app that the eval harness's LLM
  judge scored **4/10** — citing "stale token never cleared on signed-out", "403 variants
  unhandled", "no error handling" — the pattern rules alone produced **zero** findings, because
  every one of those bugs is an *absence*, and a regex can only see what is present. With the
  absence checks it produces 3, including the `error`-severity token-clearing one. Both check
  kinds are validated against the canonical `templates/web-app-secureflows` starter, which must
  stay at zero findings.

  Still heuristic text analysis, not a parser or type checker: it misses what it has no rule for,
  a project check can be satisfied by the right keyword in the wrong place, and it cannot cover
  the checks that need a running app (auth-guard mount races, the fresh-reload check). A fast
  first pass — not a replacement for the Agent implementation checklist in SKILL.md.

These static tools exist because the generated tools can't help with the part of an integration
that happens *before* a session exists — scaffolding the redirect/callback/token-lifecycle code —
which is exactly where most secureFlows integration mistakes happen.

Uses a stateless HTTP MCP transport, so the server does not persist tenant config or secrets.

## Runtime model

Each tool call receives:

- `connection.host`: secureFlows base URL
- `connection.workspaceName`: optional default workspace
- `connection.appId`: optional default application id
- `auth.*`: whichever token the selected endpoint needs

`workspaceName` and `appId` are treated as stable app config. The server injects them into known secureFlows request shapes when omitted by the caller.

## For agents (the only supported client path)

Point the MCP client at the **hosted** URL — same host as the product, path `/mcp` (not a subdomain):

| Environment | MCP URL |
|---|---|
| Production | `https://www.secure-flows.com/mcp` |
| Staging | `https://secure-flows-staging.onrender.com/mcp` |
| Health | `…/mcp/health` → `{"ok":true}` |

```json
{
  "mcpServers": {
    "secureflows": {
      "url": "https://www.secure-flows.com/mcp"
    }
  }
}
```

Do **not** tell agents to run `npx` or use `localhost` — that splits the story and breaks anyone who never starts a local process. Wired in the web Docker image (Node on `127.0.0.1:8787`, nginx `location = /mcp`; see `docs/ROUTING.md`). The Node process installs `uncaughtException` / `unhandledRejection` guards so a single bad request does not exit the process; `docker/entrypoint.sh` also restarts MCP if the process still exits.

## Local development (maintainers of this package)

```bash
cd mcp-server
npm install
npm run build
npm test
npm run dev
```

The server starts on `http://0.0.0.0:8787` by default (`POST /mcp`, `GET /health`). This is for
changing the MCP server itself — not the path product agents should configure.

## Environment variables

- `PORT`: HTTP port, default `8787` (in the web container, entrypoint sets `PORT=8787` only for the MCP child so nginx keeps Render’s public `$PORT`)
- `HOST`: bind host, default `0.0.0.0` (web container uses `127.0.0.1`)
- `ALLOWED_HOSTS`: optional comma-separated host allowlist for MCP host header validation
- `MCP_ALLOWED_HOSTS`: entrypoint override for `ALLOWED_HOSTS` when starting the in-image process

## Endpoints

- `POST /mcp`: MCP Streamable HTTP endpoint
- `GET /health`: health check (publicly exposed as `GET /mcp/health` via nginx)
## Embedding secureFlows in an application

Product apps integrate **directly** with secureFlows HTTP APIs and hosted login. Start from:

- `docs/integration/quickstart.md` — provisioning (workspace + application) and runtime hosted login
- `docs/integration/CONCEPT.md` — baseline order: **login → create workspace** before advanced features
- `docs/openapi/integration-auth.yaml` — **`/app/sessions/login`** (session apps) vs `/app/login` (legacy/console)

Product apps still integrate directly with the HTTP APIs above, not through this server. The
**generated** tools here are for agents/automation that already have a token (testing, scripted
verification). The **static** tools (`secureflows_build_login_url`, `secureflows_build_logout_url`,
`secureflows_lint_integration`) need no token and are meant to be called by a coding agent while
it's still scaffolding the integration — see **What it does** above.

## Testing this MCP server

1. `npm test` in `mcp-server/` — unit tests **plus** HTTP smoke (`test/http-smoke.test.ts`):
   starts the Express app on an ephemeral port, checks `GET /health`, `GET /mcp` → 405, and a
   real Streamable-HTTP client `listTools` + `callTool(secureflows_build_login_url)`.
2. After deploy: Playwright `tests/smoke/mcp-health.spec.ts` hits public `GET /mcp/health` and
   `GET /mcp` on the target host (production smoke job).
3. Local maintainer loop: `npm run dev`, then `curl -sS http://127.0.0.1:8787/health`.
4. Optional: MCP client against `POST /mcp` with `connection.host` + `auth.*` for generated tools.

## Deployment

Shipped inside the web Docker image and proxied at `/mcp` on `www.secure-flows.com` / staging
(see **For agents** above). No separate subdomain.

The npm package `secureflows-mcp-server` is how CI publishes a versioned artifact (and how a
standalone container can be built from `mcp-server/Dockerfile`); it is **not** the agent-facing
setup path. Publish on `v*.*.*` tags via `.github/workflows/publish-secureflows-mcp-server.yml`.

```bash
docker build -f mcp-server/Dockerfile -t secureflows-mcp-server .
docker run --rm -p 8787:8787 secureflows-mcp-server
```

## Notes

- Hosted login / redirect endpoints are exposed only if they are tagged `ai-safe` or `ai-optional` in the OpenAPI specs.
- **Documentation search** (`get_docs_search`) is `ai-safe`, requires **no** `auth.*` — only `connection.host` and query `q`.
- Human-only admin console APIs are intentionally excluded.
- The response payload from each tool includes:
  - `status`
  - `ok`
  - `url`
  - `headers`
  - `data`
