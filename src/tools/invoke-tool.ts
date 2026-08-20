import type {
  AuthRequirement,
  ConnectionConfig,
  GeneratedTool,
  InvocationResult,
  OpenApiDocument,
  ToolArguments,
} from '../openapi/types.js';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function ensureConnection(connection: ConnectionConfig | undefined): ConnectionConfig {
  if (!connection?.host) {
    throw new Error('connection.host is required');
  }
  return {
    ...connection,
    host: trimTrailingSlash(connection.host),
  };
}

export function inferAuthRequirement(tool: Pick<GeneratedTool, 'operation'>): AuthRequirement {
  const security = tool.operation.operation.security ?? [];
  for (const requirement of security) {
    const keys = Object.keys(requirement);
    if (keys.includes('firebaseBearerAuth')) {
      return 'firebaseToken';
    }
    if (keys.includes('sessionBearerAuth')) {
      return 'sessionToken';
    }
    if (keys.includes('userBearerAuth')) {
      return 'userToken';
    }
  }
  return null;
}

function ensureAuthHeader(args: ToolArguments, requirement: AuthRequirement): string | undefined {
  if (!requirement) {
    return undefined;
  }

  const token = args.auth?.[requirement];
  if (!token) {
    throw new Error(`auth.${requirement} is required`);
  }

  return `Bearer ${token}`;
}

function encodePathValue(value: unknown): string {
  return encodeURIComponent(String(value));
}

function mergeKnownConnectionValues(
  pathTemplate: string,
  query: URLSearchParams,
  body: unknown,
  connection: ConnectionConfig,
): unknown {
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as Record<string, unknown>) } : body;

  if (pathTemplate === '/api/v1/auth/callback') {
    if (connection.workspaceName && !query.has('workspace_name')) {
      query.set('workspace_name', connection.workspaceName);
    }
    if (connection.appId && !query.has('app_id')) {
      query.set('app_id', connection.appId);
    }
  }

  if (bodyObject && typeof bodyObject === 'object' && !Array.isArray(bodyObject)) {
    const obj = bodyObject as Record<string, unknown>;
    if (connection.workspaceName && obj.workspaceName == null) {
      obj.workspaceName = connection.workspaceName;
    }
    if (connection.appId && obj.app_id == null) {
      obj.app_id = connection.appId;
    }
    return obj;
  }

  return bodyObject;
}

function buildUrl(tool: GeneratedTool, args: ToolArguments, connection: ConnectionConfig): URL {
  let resolvedPath = tool.operation.path;
  const query = new URLSearchParams();
  const params = args.params ?? {};
  const queryArgs = args.query ?? {};

  for (const parameter of tool.parameters.filter(parameter => parameter.location === 'path')) {
    const value = params[parameter.name];
    if (value == null) {
      throw new Error(`params.${parameter.name} is required`);
    }
    resolvedPath = resolvedPath.replace(`{${parameter.name}}`, encodePathValue(value));
  }

  for (const parameter of tool.parameters.filter(parameter => parameter.location === 'query')) {
    const value = queryArgs[parameter.name];
    if (value == null) {
      if (parameter.required) {
        throw new Error(`query.${parameter.name} is required`);
      }
      continue;
    }
    query.set(parameter.name, String(value));
  }

  const injectedBody = mergeKnownConnectionValues(tool.operation.path, query, args.body, connection);
  if (injectedBody !== args.body) {
    args = { ...args, body: injectedBody };
  }

  const url = new URL(`${connection.host}${resolvedPath}`);
  url.search = query.toString();
  return url;
}

function mergeConnectionIntoBody(body: unknown, connection: ConnectionConfig): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const merged = { ...(body as Record<string, unknown>) };
  if (connection.workspaceName && merged.workspaceName == null) {
    merged.workspaceName = connection.workspaceName;
  }
  if (connection.appId && merged.app_id == null) {
    merged.app_id = connection.appId;
  }
  return merged;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 204) {
    return null;
  }
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  return text.length > 0 ? text : null;
}

export async function invokeTool(tool: GeneratedTool, args: ToolArguments): Promise<InvocationResult> {
  const connection = ensureConnection(args.connection);
  const authHeader = ensureAuthHeader(args, tool.authRequirement);
  const url = buildUrl(tool, args, connection);
  const requestBody = mergeConnectionIntoBody(args.body, connection);
  const headers = new Headers();

  if (authHeader) {
    headers.set('Authorization', authHeader);
  }

  let body: string | undefined;
  if (requestBody !== undefined && tool.operation.method !== 'get' && tool.operation.method !== 'head') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(requestBody);
  }

  const response = await fetch(url, {
    method: tool.operation.method.toUpperCase(),
    headers,
    body,
    redirect: 'manual',
  });

  const data = await parseResponse(response);
  const responseHeaders = Object.fromEntries(response.headers.entries());

  return {
    status: response.status,
    url: url.toString(),
    ok: response.ok,
    headers: responseHeaders,
    data,
  };
}

export function describeAuth(requirement: AuthRequirement): string {
  switch (requirement) {
    case 'firebaseToken':
      return 'Requires `auth.firebaseToken` and forwards it as a Bearer token.';
    case 'sessionToken':
      return 'Requires `auth.sessionToken` and forwards it as a Bearer token.';
    case 'userToken':
      return 'Requires `auth.userToken` and forwards it as a Bearer token.';
    default:
      return 'No Authorization header is required.';
  }
}

export function extractSuccessfulResponseSchema(document: OpenApiDocument, tool: GeneratedTool) {
  return tool.responseSchema;
}
