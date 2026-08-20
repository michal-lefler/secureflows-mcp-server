import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const STATIC_TOOL_COUNT = 3;

const DEFAULT_ORIGIN = 'https://www.secure-flows.com';
const HOSTED_LOGIN_PATH = '/app/sessions/login';
const LOGOUT_PATH = '/api/v1/auth/logout';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isCallbackUri(value: string): boolean {
  return /\/callback(\.html)?(\?|$)/i.test(value);
}

export interface BuildLoginUrlArgs {
  origin?: string;
  workspaceName: string;
  appId: string;
  redirectUri: string;
  intent?: 'fresh_login' | 'renew_expired_token';
  expiredToken?: string;
}

export interface BuildLoginUrlResult {
  url: string;
  warnings: string[];
}

export function buildLoginUrl(args: BuildLoginUrlArgs): BuildLoginUrlResult {
  const intent = args.intent ?? 'fresh_login';
  const origin = trimTrailingSlash(args.origin ?? DEFAULT_ORIGIN);
  const warnings: string[] = [];

  if (intent === 'renew_expired_token' && !args.expiredToken) {
    throw new Error('intent=renew_expired_token requires expiredToken.');
  }
  if (intent === 'fresh_login' && args.expiredToken) {
    throw new Error(
      'expiredToken must not be set when intent=fresh_login. Sending a dead/old JWT into hosted login after a fresh login or ' +
        'sign-out is the documented anti-pattern (SKILL.md PART-05: "After logout / 410: send dead JWT as session_token into ' +
        'hosted login") — it breaks renewal when the underlying identity changed. Omit expiredToken for the get-or-create path.',
    );
  }
  if (!isCallbackUri(args.redirectUri)) {
    warnings.push(
      'redirectUri does not look like a /callback (or /callback.html) route. Confirm this is intentional and that the ' +
        'exact URL is registered in the workspace dashboard allowlist.',
    );
  }

  const params = new URLSearchParams({
    app_id: args.appId,
    workspace_name: args.workspaceName,
    redirect_uri: args.redirectUri,
  });
  if (intent === 'renew_expired_token' && args.expiredToken) {
    params.set('session_token', args.expiredToken);
  }

  return { url: `${origin}${HOSTED_LOGIN_PATH}?${params.toString()}`, warnings };
}

export interface BuildLogoutUrlArgs {
  origin?: string;
  sessionToken: string;
  postLogoutRedirectUri: string;
}

export interface BuildLogoutUrlResult {
  url: string;
  navigation: 'top-level-only';
  instructions: string;
}

export function buildLogoutUrl(args: BuildLogoutUrlArgs): BuildLogoutUrlResult {
  const origin = trimTrailingSlash(args.origin ?? DEFAULT_ORIGIN);

  if (isCallbackUri(args.postLogoutRedirectUri)) {
    throw new Error(
      'postLogoutRedirectUri must not be a /callback route. After logout there is no sessionToken in the return URL, and a ' +
        'callback handler that sees a tokenless return typically treats it as a failed login and immediately redirects back to ' +
        'hosted login. Use the app root ("/") or another non-callback route.',
    );
  }
  if (/session_token=/.test(args.postLogoutRedirectUri)) {
    throw new Error(
      'postLogoutRedirectUri must not itself contain session_token. Hosted login silently renews the old session from it — the ' +
        'user is never prompted for credentials and sign-out does not actually sign them out.',
    );
  }

  const url = new URL(LOGOUT_PATH, origin);
  url.searchParams.set('session_token', args.sessionToken);
  url.searchParams.set('redirect_uri', args.postLogoutRedirectUri);

  return {
    url: url.toString(),
    navigation: 'top-level-only',
    instructions:
      'Navigate the browser to this URL with a top-level navigation (window.location.assign(...) in JS/React, ' +
      'launchUrl(uri, webOnlyWindowName: "_self") in Flutter Web). Do not call it with fetch()/XHR/http.post from a browser app, ' +
      'and do not clear local session state before this navigation starts — clearing first can trigger an auth-guard redirect ' +
      'that wins the race against this navigation.',
  };
}

const buildLoginUrlShape = {
  origin: z.string().url().default(DEFAULT_ORIGIN).describe('secureFlows origin — always https://www.secure-flows.com in production'),
  workspaceName: z.string().describe('Workspace name from the human prompt ("workspace = ...")'),
  appId: z.string().describe('App id from the human prompt ("appId = ...")'),
  redirectUri: z
    .string()
    .url()
    .describe(
      "The app's unguarded /callback URL, built from the published/allowlisted app origin — never from an iframe or editor chrome origin.",
    ),
  intent: z
    .enum(['fresh_login', 'renew_expired_token'])
    .default('fresh_login')
    .describe(
      'fresh_login: normal sign-in, or app-load restore with no prior token (default — almost always correct, including after an explicit sign-out). ' +
        'renew_expired_token: ONLY when resuming the SAME still-intended user after a soft token expiry (401/410) while staying logged in — never after Sign out.',
    ),
  expiredToken: z
    .string()
    .optional()
    .describe(
      'The old sessionToken to renew. Only read when intent=renew_expired_token. Setting this after an explicit sign-out is the ' +
        '"send a dead JWT into hosted login" anti-pattern — it breaks renewal when the underlying identity changed.',
    ),
};

const buildLogoutUrlShape = {
  origin: z.string().url().default(DEFAULT_ORIGIN).describe('secureFlows origin — always https://www.secure-flows.com in production'),
  sessionToken: z.string().describe('The current sessionToken to invalidate.'),
  postLogoutRedirectUri: z
    .string()
    .url()
    .describe(
      'Where the browser lands after logout completes — allowlisted, must NOT be /callback, and must NOT itself contain session_token.',
    ),
};

export function registerStaticTools(server: McpServer): void {
  server.registerTool(
    'secureflows_build_login_url',
    {
      title: 'Build secureFlows hosted login URL',
      description: [
        'Builds a correct hosted-login redirect URL. Needs no secureFlows token — safe to call at app-scaffolding time,',
        'before any user session exists, which is the phase most secureFlows integration mistakes happen in.',
        '',
        `Always targets ${HOSTED_LOGIN_PATH} (session apps). Never builds the legacy /app/login console URL,`,
        'which returns a firebaseToken your SecureFlowsCallback handler cannot consume and causes an infinite redirect loop.',
        '',
        'Use this instead of hand-building the URL with URLSearchParams — hand-built login URLs are the #1 source of the',
        'login-loop and stale-renewal bugs documented in SKILL.md.',
      ].join('\n'),
      inputSchema: buildLoginUrlShape,
    },
    async args => {
      try {
        const result = buildLoginUrl(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: { ...result },
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    'secureflows_build_logout_url',
    {
      title: 'Build secureFlows redirect-logout URL',
      description: [
        'Builds a correct redirect-logout URL and refuses to build one that violates the two documented logout anti-patterns:',
        'a redirect_uri pointing at /callback (SPA callback handlers treat the tokenless return as a failed login and loop),',
        'and a redirect_uri that itself embeds session_token (silently renews the old session instead of signing out).',
        '',
        'The result always instructs top-level navigation, never fetch/XHR — cross-site fetch() to this endpoint gets a 200 but',
        'browsers silently ignore its Clear-Site-Data header on cross-site responses, so the hosted-login cookie survives and the',
        'user silently re-authenticates on the next login redirect. This tool never builds a revoke request: revoke permanently',
        'destroys the user\'s data and must only run on an explicit "delete my account" action, never on ordinary sign-out.',
      ].join('\n'),
      inputSchema: buildLogoutUrlShape,
    },
    async args => {
      try {
        const result = buildLogoutUrl(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: { ...result },
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    'secureflows_lint_integration',
    {
      title: 'Static-scan generated code for secureFlows anti-patterns',
      description: [
        'Checks source you already generated against the secureFlows integration rules. Needs no secureFlows token; safe at',
        'scaffolding time. Pass every auth/session-related file in one call — some checks are evaluated across the whole set.',
        '',
        'Two kinds of findings:',
        '  • scope "file"    — a forbidden construct is present (localStorage token, legacy /app/login, fetch-based logout,',
        '    client-side JWT decode, empty catch, restore non-auth errors clearing session UI, Continue CTA gated on null session, ...), reported at an exact file:line.',
        '  • scope "project" — REQUIRED handling is missing everywhere you passed in: detecting 401/410 but never clearing the',
        '    token, never handling 403, or handling 403 without the BILLING_GRACE_LOCK carve-out. These are the defects that',
        '    actually dominate real generated apps, and no "forbidden pattern" check can see them, because the bug is an absence.',
        '',
        'Heuristic text analysis, not a parser or a type checker. It can miss things it has no rule for, and a project check can',
        'be satisfied by the right keyword in the wrong place. It is a fast first pass — not a substitute for the Agent',
        'implementation checklist in SKILL.md, and specifically not for the checks that need a running app (auth-guard mount',
        'races, the fresh-reload check). Fix every "error" before calling an integration done; treat "needs_review" as a lead.',
      ].join('\n'),
      inputSchema: {
        files: z
          .record(z.string(), z.string())
          .describe('Map of relative file path -> full file source to scan, e.g. { "src/lib/secureflows.js": "..." }'),
      },
    },
    async args => {
      try {
        const findings = lintFiles(args.files);
        const summary = {
          errorCount: findings.filter(f => f.severity === 'error').length,
          needsReviewCount: findings.filter(f => f.severity === 'needs_review').length,
          findings,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
          structuredContent: summary,
          isError: summary.errorCount > 0,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}

function toolErrorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  };
}

export type LintSeverity = 'error' | 'needs_review';

export interface LintFinding {
  file: string;
  line: number;
  rule: string;
  severity: LintSeverity;
  /**
   * 'file'    — a forbidden construct was found at this exact file:line.
   * 'project' — required handling is MISSING across every file passed in. file/line point at a
   *             representative session-touching file only so the finding has somewhere to anchor;
   *             the fix usually belongs wherever that project centralizes session handling.
   */
  scope: 'file' | 'project';
  message: string;
}

interface LintRule {
  id: string;
  severity: LintSeverity;
  pattern: RegExp;
  message: string;
}

/**
 * Absence checks. These exist because the forbidden-pattern rules below structurally cannot catch
 * the defect class that actually dominates real generated secureFlows apps: not "wrote something
 * banned" but "never wrote the required handling at all". Verified against a real trial whose app
 * scored 4/10 on the LLM judge for exactly these defects while triggering zero pattern rules.
 *
 * Evaluated across ALL files passed in, not per file — a correct app may legitimately centralize
 * signed-out handling in one module (the canonical starter template does), so a per-file version
 * would fire constantly on correct code.
 */
interface ProjectCheck {
  id: string;
  severity: LintSeverity;
  /** Only evaluated when this matches somewhere — keeps the check off unrelated files. */
  gate: RegExp;
  /** The handling that must appear somewhere. Absent while `gate` matched ⇒ finding. */
  requires: RegExp;
  message: string;
}

const LINT_RULES: LintRule[] = [
  {
    id: 'env-var-config-constants',
    severity: 'error',
    pattern: /process\.env\.(SECUREFLOWS_ORIGIN|SECUREFLOWS_APP_ID|SECUREFLOWS_WORKSPACE)\b/,
    message:
      'SECUREFLOWS_ORIGIN / SECUREFLOWS_APP_ID / SECUREFLOWS_WORKSPACE must be hardcoded constants, never read from environment variables.',
  },
  {
    id: 'token-in-localstorage',
    severity: 'error',
    pattern: /localStorage\.setItem\([^)]*token[^)]*\)/i,
    message: 'sessionToken must live in SDK-managed sessionStorage, never localStorage (survives across tabs/devices in an unsafe way).',
  },
  {
    id: 'legacy-login-endpoint',
    severity: 'error',
    pattern: /\/app\/login\b/,
    message:
      'Use /app/sessions/login for session apps, not the legacy /app/login console endpoint — it returns a firebaseToken your ' +
      'callback handler cannot consume and causes an infinite redirect loop.',
  },
  {
    id: 'fetch-xhr-logout',
    severity: 'error',
    pattern: /(fetch|http\.post)\([^)]*\/api\/v1\/auth\/logout/i,
    message:
      'Do not call POST /api/v1/auth/logout via fetch/XHR from a browser app — Clear-Site-Data is silently ignored on cross-site ' +
      'responses, so the hosted-login cookie survives and the user silently re-authenticates. Use a top-level redirect navigation.',
  },
  {
    id: 'session-token-in-post-logout-redirect',
    severity: 'error',
    pattern: /\/callback[^"'`\n]*session_token/i,
    message: 'The post-logout redirect_uri must not contain session_token — it silently renews the old session instead of signing out.',
  },
  {
    id: 'iframe-hosted-login',
    severity: 'error',
    pattern: /<iframe[^>]*(hostedLogin|secure-flows\.com\/app\/sessions\/login|SECUREFLOWS_ORIGIN)/i,
    message: 'Hosted login must be a full-page redirect (window.location.href / launchUrl), never rendered inside an iframe.',
  },
  {
    id: 'in-app-login-route',
    severity: 'error',
    pattern: /(navigate\(\s*["'`]\/login["'`]\)|pushNamed\([^,]*,\s*["'`]\/login["'`]\))/,
    message: 'Do not invent an in-app /login route — hosted login is the only sign-in UI; start it from sf.login({ redirectUri }).',
  },
  {
    id: 'jwt-decode-client',
    severity: 'error',
    pattern: /\b(jwtDecode|jwt\.decode|decodeJwt)\s*\(/,
    message: 'Never decode sessionToken/JWT client-side to extract identity — identity is always resolved server-side from the token.',
  },
  {
    id: 'revoke-call-near-logout',
    severity: 'needs_review',
    pattern: /\b(revokeSession|sessions\/revoke|\.revoke\()/,
    message:
      'Found a revoke call. Revoke permanently destroys session data and must only run on an explicit "delete my account" / ' +
      '"revoke this session" action — never as part of ordinary sign-out. Confirm this call site is not wired to a Sign out button.',
  },
  {
    id: 'requireauth-wraps-callback',
    severity: 'needs_review',
    pattern: /<(RequireAuth|ProtectedRoute)[^>]*>[\s\S]{0,200}?Callback/,
    message:
      '/callback must be rendered outside any auth guard (unguarded route). Confirm the callback route is not nested inside ' +
      'RequireAuth/ProtectedRoute — that produces an infinite login loop.',
  },
  {
    id: 'empty-catch-swallows-error',
    severity: 'needs_review',
    pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
    message:
      'Empty catch block silently swallows the error. On a Session API call this hides signed-out (401/410/403) from the user ' +
      'AND from the signed-out handling path — the app keeps rendering a signed-in shell against a dead token. Handle the ' +
      'error or let it propagate to something that does.',
  },
  {
    id: 'restore-non-auth-clears-session-ui',
    severity: 'error',
    pattern:
      /isRestoreSignedOutError[\s\S]{0,1500}?else\s*\{[\s\S]{0,600}?setSession\(\s*null\s*\)/,
    message:
      'Restore treats a non-signed-out failure (BILLING_GRACE_LOCK / 5xx / network) by clearing React session state. Keep the ' +
      'token and the signed-in shell and show a banner — do not setSession(null) in that else branch. Gating Continue CTA on ' +
      '`if (!session)` then shows a sign-in button while the token is still stored.',
  },
  {
    id: 'cta-gated-on-null-session',
    severity: 'error',
    pattern: /if\s*\(\s*!session[\s\S]{0,80}?\)[\s\S]{0,500}?Continue with secureFlows/,
    message:
      'Continue with secureFlows is gated on `session` being null. A billing lock or transient restore error often leaves ' +
      'session unset while the token is still valid — that must stay signed-in with a banner. Gate the CTA on whether a token ' +
      'is stored (`hasToken` / `sf.getToken()`), not on the payload.',
  },
];

const PROJECT_CHECKS: ProjectCheck[] = [
  {
    id: 'signed-out-never-clears-token',
    severity: 'error',
    gate: /\b(401|410)\b|signed_?out/i,
    requires: /\.logout\s*\(|removeItem\s*\(|clearSessionToken|clearToken/,
    message:
      'This code detects signed-out (401/410) but never clears the stored session token anywhere — no sf.logout(), ' +
      'sessionStorage.removeItem(), or equivalent. The token stays in storage, so the app restores the same dead token on the ' +
      'next load and the user is stuck in a signed-in shell with a dead Sign out. Clear the token AND the app auth UI state, ' +
      'then show hosted login / the Continue CTA.',
  },
  {
    id: 'session-403-unhandled',
    severity: 'needs_review',
    gate: /\/api\/v1\/sessions|sessionFetch|fetchSession/,
    requires: /\b403\b/,
    message:
      'Calls the Session API but never handles 403. An empty-body 403 and a JSON 403 "Access denied" both mean signed-out ' +
      '(stale idle JWT) and must clear the token like 401/410 — otherwise the app loops on a dead token showing error banners. ' +
      'Note a 403 with code BILLING_GRACE_LOCK is the one 403 that is NOT signed-out.',
  },
  {
    id: 'billing-grace-lock-unhandled',
    severity: 'needs_review',
    gate: /\b403\b/,
    requires: /BILLING_GRACE_LOCK/,
    message:
      'Handles 403 but never mentions BILLING_GRACE_LOCK. That specific 403 is a billing lock, NOT a sign-out: treating it as ' +
      'signed-out logs the user out over a payment state they cannot fix from there. Keep the token and the signed-in shell, ' +
      'and show an error banner instead.',
  },
];

export function lintFiles(files: Record<string, string>): LintFinding[] {
  const findings: LintFinding[] = [];
  const entries = Object.entries(files);

  // Pass 1 — forbidden construct present, anchored to an exact file:line.
  for (const [file, source] of entries) {
    for (const rule of LINT_RULES) {
      const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
      for (const match of source.matchAll(globalPattern)) {
        const upToMatch = source.slice(0, match.index ?? 0);
        const line = upToMatch.split('\n').length;
        findings.push({
          file,
          line,
          rule: rule.id,
          severity: rule.severity,
          scope: 'file',
          message: rule.message,
        });
      }
    }
  }

  // Pass 2 — required handling absent anywhere in the whole set of files.
  for (const check of PROJECT_CHECKS) {
    const gateFile = entries.find(([, source]) => check.gate.test(source));
    if (!gateFile) {
      continue;
    }
    const satisfied = entries.some(([, source]) => check.requires.test(source));
    if (!satisfied) {
      findings.push({
        file: gateFile[0],
        line: 1,
        rule: check.id,
        severity: check.severity,
        scope: 'project',
        message: check.message,
      });
    }
  }

  return findings;
}
