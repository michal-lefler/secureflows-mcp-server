import { resolveMediaTypeSchema } from './load-spec.js';
import type {
  GeneratedTool,
  HttpMethod,
  LoadedSpec,
  OpenApiDocument,
  OpenApiOperation,
  SelectedOperation,
  SupportedTag,
  ToolParameter,
} from './types.js';

const ALLOWED_TAGS: SupportedTag[] = ['ai-safe', 'ai-optional'];
const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

function includesAllowedTag(tags: string[] | undefined): tags is SupportedTag[] {
  return Boolean(tags?.some(tag => ALLOWED_TAGS.includes(tag as SupportedTag)));
}

function dedupeKey(method: HttpMethod, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function normalizeToolName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** Shortens names like `get_api_v1_sessions` → `get_sessions` (drops leading `api_vN` after HTTP verb). */
function shortenToolNameAfterNormalize(name: string): string {
  return name.replace(
    /^(get|post|put|patch|delete|options|head)_api_v\d+_(.+)$/,
    '$1_$2',
  );
}

function buildFallbackToolName(method: HttpMethod, apiPath: string): string {
  const pathPart = apiPath.replace(/^\/+/, '').replace(/\{([^}]+)\}/g, '$1');
  return normalizeToolName(`${method}_${pathPart}`);
}

function buildToolTitle(operation: OpenApiOperation, method: HttpMethod, apiPath: string): string {
  return operation.summary ?? `${method.toUpperCase()} ${apiPath}`;
}

function collectParameters(
  document: OpenApiDocument,
  operation: OpenApiOperation,
): ToolParameter[] {
  const params = operation.parameters ?? [];
  return params
    .filter(parameter => parameter.in === 'path' || parameter.in === 'query')
    .map(parameter => ({
      name: parameter.name,
      location: parameter.in as 'path' | 'query',
      required: Boolean(parameter.required || parameter.in === 'path'),
      description: parameter.description,
      schema: parameter.schema ?? { type: 'string' },
    }));
}

export function selectOperations(specs: LoadedSpec[]): SelectedOperation[] {
  const selected: SelectedOperation[] = [];
  const seen = new Set<string>();

  for (const spec of specs) {
    const paths = spec.document.paths ?? {};
    for (const [apiPath, pathItem] of Object.entries(paths)) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem?.[method];
        if (!operation || !includesAllowedTag(operation.tags)) {
          continue;
        }
        const key = dedupeKey(method, apiPath);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        selected.push({
          sourcePath: spec.sourcePath,
          specTitle: spec.document.info?.title ?? spec.sourcePath,
          path: apiPath,
          method,
          operation,
          document: spec.document,
        });
      }
    }
  }

  return selected;
}

export function selectOperationTools(specs: LoadedSpec[]): GeneratedTool[] {
  return selectOperations(specs).map(selected => {
    const responseSchema = resolveMediaTypeSchema(
      selected.document,
      selected.operation.responses?.['200']?.content,
    );
    const requestBodySchema = resolveMediaTypeSchema(
      selected.document,
      selected.operation.requestBody?.content,
    );
    const name = shortenToolNameAfterNormalize(
      normalizeToolName(
        selected.operation.operationId ?? buildFallbackToolName(selected.method, selected.path),
      ),
    );

    return {
      name,
      title: buildToolTitle(selected.operation, selected.method, selected.path),
      description:
        selected.operation.description ??
        selected.operation.summary ??
        `${selected.method.toUpperCase()} ${selected.path}`,
      authRequirement: null,
      operation: selected,
      parameters: collectParameters(selected.document, selected.operation),
      requestBodySchema,
      responseSchema,
    };
  });
}
