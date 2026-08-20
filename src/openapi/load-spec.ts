import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import type { JsonSchema, LoadedSpec, OpenApiDocument } from './types.js';

function assertDocument(value: unknown, sourcePath: string): OpenApiDocument {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid OpenAPI document in ${sourcePath}`);
  }
  return value as OpenApiDocument;
}

export async function loadSpec(sourcePath: string): Promise<LoadedSpec> {
  const raw = await readFile(sourcePath, 'utf8');
  const document = assertDocument(YAML.parse(raw), sourcePath);
  return {
    sourcePath,
    document,
  };
}

export async function loadSpecs(sourcePaths: string[]): Promise<LoadedSpec[]> {
  return Promise.all(sourcePaths.map(loadSpec));
}

export function resolveSchemaRef(document: OpenApiDocument, schema?: JsonSchema): JsonSchema | undefined {
  if (!schema) {
    return undefined;
  }
  if (!schema.$ref) {
    return schema;
  }

  const prefix = '#/components/schemas/';
  if (!schema.$ref.startsWith(prefix)) {
    throw new Error(`Unsupported schema reference: ${schema.$ref}`);
  }

  const schemaName = schema.$ref.slice(prefix.length);
  const resolved = document.components?.schemas?.[schemaName];
  if (!resolved) {
    throw new Error(`Missing schema '${schemaName}'`);
  }

  return resolveSchemaRef(document, resolved);
}

export function resolveMediaTypeSchema(
  document: OpenApiDocument,
  content?: Record<string, { schema?: JsonSchema }>,
): JsonSchema | undefined {
  if (!content) {
    return undefined;
  }

  const preferred = content['application/json']?.schema;
  if (preferred) {
    return resolveSchemaRef(document, preferred);
  }

  const firstEntry = Object.values(content)[0]?.schema;
  return resolveSchemaRef(document, firstEntry);
}

export function specLabel(sourcePath: string, document: OpenApiDocument): string {
  return document.info?.title ?? path.basename(sourcePath);
}
