import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { resolveMediaTypeSchema } from '../openapi/load-spec.js';
import { selectOperationTools } from '../openapi/select-operations.js';
import type {
  AuthRequirement,
  GeneratedTool,
  InvocationResult,
  JsonSchema,
  LoadedSpec,
  ToolArguments,
} from '../openapi/types.js';
import { describeAuth, inferAuthRequirement, invokeTool } from './invoke-tool.js';
import { jsonSchemaToZod } from './json-schema.js';

const connectionSchema = z.object({
  host: z.string().url().describe('secureFlows base URL, for example https://api.example.com'),
  workspaceName: z.string().optional().describe('Optional workspace name used as a default for tools that need it'),
  appId: z.string().optional().describe('Optional secureFlows app id used as a default for hosted login tools'),
});

function authSchema(requirement: AuthRequirement): z.ZodTypeAny {
  switch (requirement) {
    case 'firebaseToken':
      return z.object({
        firebaseToken: z.string().describe('Firebase ID token'),
      });
    case 'sessionToken':
      return z.object({
        sessionToken: z.string().describe('secureFlows session token'),
      });
    case 'userToken':
      return z.object({
        userToken: z.string().describe('secureFlows USER token'),
      });
    default:
      return z.object({}).optional();
  }
}

function parametersSchema(tool: GeneratedTool): z.ZodTypeAny {
  const pathParams = tool.parameters.filter(parameter => parameter.location === 'path');
  if (pathParams.length === 0) {
    return z.object({}).optional();
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const parameter of pathParams) {
    let schema = jsonSchemaToZod(parameter.schema);
    if (!parameter.required) {
      schema = schema.optional();
    }
    shape[parameter.name] = parameter.description ? schema.describe(parameter.description) : schema;
  }
  return z.object(shape);
}

function querySchema(tool: GeneratedTool): z.ZodTypeAny {
  const queryParams = tool.parameters.filter(parameter => parameter.location === 'query');
  if (queryParams.length === 0) {
    return z.object({}).optional();
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const parameter of queryParams) {
    let schema = jsonSchemaToZod(parameter.schema);
    if (!parameter.required) {
      schema = schema.optional();
    }
    shape[parameter.name] = parameter.description ? schema.describe(parameter.description) : schema;
  }
  return z.object(shape);
}

function bodySchema(schema?: JsonSchema): z.ZodTypeAny {
  return schema ? jsonSchemaToZod(schema) : z.any().optional();
}

function toolDescription(tool: GeneratedTool): string {
  const description = tool.description.trim();
  return [
    description,
    '',
    `Source: ${tool.operation.method.toUpperCase()} ${tool.operation.path}`,
    describeAuth(tool.authRequirement),
    'Prefer connection.workspaceName and connection.appId as stable config instead of generating identity fields dynamically.',
  ].join('\n');
}

function resultToText(result: InvocationResult): string {
  return JSON.stringify(result, null, 2);
}

export function buildGeneratedTools(specs: LoadedSpec[]): GeneratedTool[] {
  return selectOperationTools(specs).map(tool => ({
    ...tool,
    authRequirement: inferAuthRequirement(tool),
    requestBodySchema:
      tool.requestBodySchema ?? resolveMediaTypeSchema(tool.operation.document, tool.operation.operation.requestBody?.content),
  }));
}

export function registerGeneratedTools(server: McpServer, tools: GeneratedTool[]): Map<string, GeneratedTool> {
  const toolMap = new Map<string, GeneratedTool>();

  for (const tool of tools) {
    toolMap.set(tool.name, tool);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: toolDescription(tool),
        inputSchema: {
          connection: connectionSchema,
          auth: authSchema(tool.authRequirement).optional(),
          params: parametersSchema(tool),
          query: querySchema(tool),
          body: bodySchema(tool.requestBodySchema),
        },
      },
      async args => {
        try {
          const result = await invokeTool(tool, args as ToolArguments);
          return {
            content: [
              {
                type: 'text',
                text: resultToText(result),
              },
            ],
            structuredContent: { ...result },
            isError: !result.ok,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: message,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  return toolMap;
}
