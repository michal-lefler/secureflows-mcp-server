import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLoginUrl, buildLogoutUrl, lintFiles } from '../src/tools/static-tools.js';

test('buildLoginUrl targets /app/sessions/login, never legacy /app/login', () => {
  const { url, warnings } = buildLoginUrl({
    workspaceName: 'demo-workspace',
    appId: 'demo-app',
    redirectUri: 'https://myapp.com/callback',
  });

  assert.match(url, /^https:\/\/www\.secure-flows\.com\/app\/sessions\/login\?/);
  assert.doesNotMatch(url, /\/app\/login\?/);
  assert.deepEqual(warnings, []);
});

test('buildLoginUrl warns when redirectUri is not a /callback route', () => {
  const { warnings } = buildLoginUrl({
    workspaceName: 'demo-workspace',
    appId: 'demo-app',
    redirectUri: 'https://myapp.com/',
  });

  assert.equal(warnings.length, 1);
});

test('buildLoginUrl rejects expiredToken on a fresh_login (the "dead JWT into hosted login" anti-pattern)', () => {
  assert.throws(
    () =>
      buildLoginUrl({
        workspaceName: 'demo-workspace',
        appId: 'demo-app',
        redirectUri: 'https://myapp.com/callback',
        intent: 'fresh_login',
        expiredToken: 'old-token',
      }),
    /must not be set when intent=fresh_login/,
  );
});

test('buildLoginUrl requires expiredToken when renewing', () => {
  assert.throws(
    () =>
      buildLoginUrl({
        workspaceName: 'demo-workspace',
        appId: 'demo-app',
        redirectUri: 'https://myapp.com/callback',
        intent: 'renew_expired_token',
      }),
    /requires expiredToken/,
  );
});

test('buildLoginUrl includes session_token only for renew_expired_token', () => {
  const { url } = buildLoginUrl({
    workspaceName: 'demo-workspace',
    appId: 'demo-app',
    redirectUri: 'https://myapp.com/callback',
    intent: 'renew_expired_token',
    expiredToken: 'old-token',
  });

  assert.match(url, /session_token=old-token/);
});

test('buildLogoutUrl rejects a /callback post-logout redirect', () => {
  assert.throws(
    () =>
      buildLogoutUrl({
        sessionToken: 'tok',
        postLogoutRedirectUri: 'https://myapp.com/callback',
      }),
    /must not be a \/callback route/,
  );
});

test('buildLogoutUrl rejects a redirect_uri that itself embeds session_token', () => {
  assert.throws(
    () =>
      buildLogoutUrl({
        sessionToken: 'tok',
        postLogoutRedirectUri: 'https://myapp.com/?session_token=old',
      }),
    /must not itself contain session_token/,
  );
});

test('buildLogoutUrl builds a first-party redirect logout URL with top-level-only navigation', () => {
  const result = buildLogoutUrl({
    sessionToken: 'tok',
    postLogoutRedirectUri: 'https://myapp.com/',
  });

  assert.match(result.url, /^https:\/\/www\.secure-flows\.com\/api\/v1\/auth\/logout\?/);
  assert.match(result.url, /session_token=tok/);
  assert.equal(result.navigation, 'top-level-only');
});

test('lintFiles flags the documented anti-patterns', () => {
  const findings = lintFiles({
    'src/lib/secureflows.js': [
      'const origin = process.env.SECUREFLOWS_ORIGIN;',
      'localStorage.setItem("sessionToken", token);',
      'window.location.href = `${ORIGIN}/app/login?workspace_name=x`;',
      'fetch(`${ORIGIN}/api/v1/auth/logout`, { method: "POST" });',
      'const { userId } = jwtDecode(sessionToken);',
    ].join('\n'),
  });

  const rules = new Set(findings.map(f => f.rule));
  assert.ok(rules.has('env-var-config-constants'));
  assert.ok(rules.has('token-in-localstorage'));
  assert.ok(rules.has('legacy-login-endpoint'));
  assert.ok(rules.has('fetch-xhr-logout'));
  assert.ok(rules.has('jwt-decode-client'));
});

test('lintFiles reports 1-indexed line numbers', () => {
  const findings = lintFiles({
    'a.js': ['// line 1', '// line 2', 'const x = process.env.SECUREFLOWS_APP_ID;'].join('\n'),
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].scope, 'file');
});

// --- Absence checks -------------------------------------------------------
// Regression guard for the gap these were built to close: this exact shape (detects 401/410,
// throws, never clears the token) is what a real trial produced and scored 4/10 on the LLM judge
// while triggering ZERO pattern rules.

test('lintFiles flags detecting signed-out without ever clearing the token', () => {
  const findings = lintFiles({
    'src/App.jsx': [
      'const res = await fetch(`${ORIGIN}/api/v1/sessions/get/${key}`, { headers });',
      'if (res.status === 401 || res.status === 410) throw new Error("signed_out");',
    ].join('\n'),
  });

  const cleared = findings.find(f => f.rule === 'signed-out-never-clears-token');
  assert.ok(cleared, 'expected signed-out-never-clears-token');
  assert.equal(cleared?.severity, 'error');
  assert.equal(cleared?.scope, 'project');
});

test('lintFiles accepts token clearing in a DIFFERENT file than the detection', () => {
  // The canonical starter centralizes signed-out handling, so a per-file check would false-positive
  // here. Absence checks are evaluated across every file passed in, precisely to allow this.
  const findings = lintFiles({
    'src/api.js': 'if (res.status === 401 || res.status === 410) throw new Error("signed_out");',
    'src/session.js': 'export function handleSignedOut() { sf.logout(); setSession(null); }',
  });

  assert.equal(findings.filter(f => f.rule === 'signed-out-never-clears-token').length, 0);
});

test('lintFiles flags 403 handling that ignores the BILLING_GRACE_LOCK carve-out', () => {
  const findings = lintFiles({
    'src/api.js': [
      'const res = await fetch(`${ORIGIN}/api/v1/sessions`, { headers });',
      'if (res.status === 401 || res.status === 403) { sf.logout(); showLogin(); }',
    ].join('\n'),
  });

  assert.ok(findings.some(f => f.rule === 'billing-grace-lock-unhandled'));
  // 403 IS handled here, so the "never handles 403" check must stay quiet.
  assert.equal(findings.filter(f => f.rule === 'session-403-unhandled').length, 0);
});

test('lintFiles absence checks stay silent on code that never touches sessions', () => {
  const findings = lintFiles({
    'src/math.js': 'export const add = (a, b) => a + b;',
    'src/ui.jsx': 'export function Button({ onClick }) { return <button onClick={onClick} />; }',
  });

  assert.deepEqual(findings, []);
});

test('lintFiles flags an empty catch block', () => {
  const findings = lintFiles({
    'src/App.jsx': 'try { const d = await getKey("profile", token); } catch {}',
  });

  assert.ok(findings.some(f => f.rule === 'empty-catch-swallows-error'));
});

test('lintFiles flags restore non-auth errors that clear session UI (Continue CTA while token remains)', () => {
  const findings = lintFiles({
    'src/lib/secureFlowsSession.tsx': [
      'const signedOut = isRestoreSignedOutError(e);',
      'if (signedOut) {',
      '  handleSignedOut();',
      '} else {',
      '  setSession(null);',
      '  setError(e.message);',
      '}',
    ].join('\n'),
  });

  assert.ok(findings.some(f => f.rule === 'restore-non-auth-clears-session-ui'));
});

test('lintFiles flags Continue CTA gated on null session payload', () => {
  const findings = lintFiles({
    'src/App.tsx': [
      'if (!session) {',
      '  return (',
      '    <button type="button" onClick={() => void login()}>',
      '      Continue with secureFlows',
      '    </button>',
      '  );',
      '}',
    ].join('\n'),
  });

  assert.ok(findings.some(f => f.rule === 'cta-gated-on-null-session'));
});

test('lintFiles accepts Continue CTA gated on hasToken', () => {
  const findings = lintFiles({
    'src/App.tsx': [
      'if (!hasToken) {',
      '  return (',
      '    <button type="button" onClick={() => void login()}>',
      '      Continue with secureFlows',
      '    </button>',
      '  );',
      '}',
    ].join('\n'),
    'src/lib/secureFlowsSession.tsx': [
      'const signedOut = isRestoreSignedOutError(e);',
      'if (signedOut) {',
      '  handleSignedOut();',
      '} else {',
      '  setHasToken(true);',
      '  setError(e.message);',
      '}',
    ].join('\n'),
  });

  assert.equal(findings.filter(f => f.rule === 'cta-gated-on-null-session').length, 0);
  assert.equal(findings.filter(f => f.rule === 'restore-non-auth-clears-session-ui').length, 0);
});

test('lintFiles finds no issues in clean source', () => {
  const findings = lintFiles({
    'src/lib/secureflows.js': [
      'export const SECUREFLOWS_ORIGIN = "https://www.secure-flows.com";',
      'export const SECUREFLOWS_APP_ID = "demo-app";',
      'sessionStorage.setItem(TOKEN_KEY, token);',
    ].join('\n'),
  });

  assert.deepEqual(findings, []);
});

test('lintFiles finds no issues in the canonical React starter', () => {
  // Vendored from the private secureFlows monorepo's templates/web-app-secureflows/src —
  // this repo is a public mirror with no sibling templates/ directory of its own.
  const templateSrc = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'fixtures/web-app-secureflows/src',
  );

  function readTree(dir: string, prefix = ''): Record<string, string> {
    const files: Record<string, string> = {};
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) {
        Object.assign(files, readTree(full, rel));
      } else {
        files[rel] = fs.readFileSync(full, 'utf8');
      }
    }
    return files;
  }

  const findings = lintFiles(readTree(templateSrc));
  assert.deepEqual(findings, []);
});
