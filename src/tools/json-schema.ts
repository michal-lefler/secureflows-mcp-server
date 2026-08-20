import * as z from 'zod/v4';

import type { JsonSchema } from '../openapi/types.js';

function withDescription<T extends z.ZodTypeAny>(schema: T, jsonSchema?: JsonSchema): T {
  return jsonSchema?.description ? schema.describe(jsonSchema.description) : schema;
}

function applyNullability(schema: z.ZodTypeAny, jsonSchema?: JsonSchema): z.ZodTypeAny {
  return jsonSchema?.nullable ? schema.nullable() : schema;
}

function applyOptional(schema: z.ZodTypeAny, required: boolean): z.ZodTypeAny {
  return required ? schema : schema.optional();
}

export function jsonSchemaToZod(schema?: JsonSchema): z.ZodTypeAny {
  if (!schema) {
    return z.any();
  }

  if (schema.oneOf?.length) {
    const variants = schema.oneOf.map(jsonSchemaToZod);
    return applyNullability(withDescription(z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]), schema), schema);
  }

  if (schema.anyOf?.length) {
    const variants = schema.anyOf.map(jsonSchemaToZod);
    return applyNullability(withDescription(z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]), schema), schema);
  }

  if (schema.enum?.length) {
    const enumValues = schema.enum.filter(value => typeof value === 'string') as string[];
    if (enumValues.length === schema.enum.length && enumValues.length > 0) {
      return applyNullability(withDescription(z.enum(enumValues as [string, ...string[]]), schema), schema);
    }
    return applyNullability(withDescription(z.any(), schema), schema);
  }

  switch (schema.type) {
    case 'string':
      if (schema.format === 'uri') {
        return applyNullability(withDescription(z.string().url(), schema), schema);
      }
      return applyNullability(withDescription(z.string(), schema), schema);
    case 'integer': {
      let integerSchema = z.number().int();
      if (typeof schema.minimum === 'number') {
        integerSchema = integerSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === 'number') {
        integerSchema = integerSchema.max(schema.maximum);
      }
      return applyNullability(withDescription(integerSchema, schema), schema);
    }
    case 'number': {
      let numberSchema = z.number();
      if (typeof schema.minimum === 'number') {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === 'number') {
        numberSchema = numberSchema.max(schema.maximum);
      }
      return applyNullability(withDescription(numberSchema, schema), schema);
    }
    case 'boolean':
      return applyNullability(withDescription(z.boolean(), schema), schema);
    case 'array':
      return applyNullability(withDescription(z.array(jsonSchemaToZod(schema.items)), schema), schema);
    case 'object':
    default: {
      if (schema.properties) {
        const required = new Set(schema.required ?? []);
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(schema.properties)) {
          shape[key] = applyOptional(jsonSchemaToZod(value), required.has(key));
        }
        let objectSchema = z.object(shape);
        if (schema.additionalProperties) {
          objectSchema = objectSchema.catchall(
            schema.additionalProperties === true
              ? z.any()
              : jsonSchemaToZod(schema.additionalProperties),
          );
        }
        return applyNullability(withDescription(objectSchema, schema), schema);
      }

      if (schema.additionalProperties) {
        return applyNullability(
          withDescription(
            z.record(
              z.string(),
              schema.additionalProperties === true
                ? z.any()
                : jsonSchemaToZod(schema.additionalProperties),
            ),
            schema,
          ),
          schema,
        );
      }

      if (schema.type === 'object') {
        return applyNullability(withDescription(z.record(z.string(), z.any()), schema), schema);
      }

      return applyNullability(withDescription(z.any(), schema), schema);
    }
  }
}
