export type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'options'
  | 'head';

export interface OpenApiDocument {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
  };
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  headers?: Record<string, unknown>;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiMediaType {
  schema?: JsonSchema;
}

export interface OpenApiSecurityScheme {
  type?: string;
  scheme?: string;
  bearerFormat?: string;
  description?: string;
}

export interface JsonSchema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  title?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  nullable?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

export interface LoadedSpec {
  sourcePath: string;
  document: OpenApiDocument;
}

export interface SelectedOperation {
  sourcePath: string;
  specTitle: string;
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
  document: OpenApiDocument;
}

export type SupportedTag = 'ai-safe' | 'ai-optional';

export type AuthRequirement = 'firebaseToken' | 'sessionToken' | 'userToken' | null;

export interface ToolParameter {
  name: string;
  location: 'path' | 'query';
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

export interface GeneratedTool {
  name: string;
  title: string;
  description: string;
  authRequirement: AuthRequirement;
  operation: SelectedOperation;
  parameters: ToolParameter[];
  requestBodySchema?: JsonSchema;
  responseSchema?: JsonSchema;
}

export interface ConnectionConfig {
  host: string;
  workspaceName?: string;
  appId?: string;
}

export interface ToolArguments {
  connection: ConnectionConfig;
  auth?: {
    firebaseToken?: string;
    sessionToken?: string;
    userToken?: string;
  };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface InvocationResult {
  status: number;
  url: string;
  ok: boolean;
  headers: Record<string, string>;
  data: unknown;
}
