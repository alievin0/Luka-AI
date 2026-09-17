// A tiny runtime validator for the JSON-Schema subset used by ability
// manifests. The same schema object is reused as an Anthropic tool schema, so
// an ability is described exactly once and stays in sync everywhere.

import type { JsonSchema } from "./types.ts";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function validate<T>(
  schema: JsonSchema,
  input: unknown,
  path = "input",
): ValidationResult<T> {
  const errors: string[] = [];
  const value = walk(schema, input, path, errors);
  return errors.length === 0
    ? { ok: true, value: value as T }
    : { ok: false, errors };
}

function walk(
  schema: JsonSchema,
  input: unknown,
  path: string,
  errors: string[],
): unknown {
  if (input === undefined || input === null) {
    return schema.default;
  }

  switch (schema.type) {
    case "object": {
      if (typeof input !== "object" || Array.isArray(input)) {
        errors.push(`${path} must be an object`);
        return undefined;
      }
      // An object schema with no declared properties is a free-form bag — pass
      // it through untouched rather than stripping it to nothing. Ability
      // inputs nested inside a plan rely on this.
      if (!schema.properties) return input;
      const source = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        const raw = source[key];
        const required = schema.required?.includes(key) ?? false;
        if (raw === undefined || raw === null) {
          if (sub.default !== undefined) out[key] = sub.default;
          else if (required) errors.push(`${path}.${key} is required`);
          continue;
        }
        const parsed = walk(sub, raw, `${path}.${key}`, errors);
        if (parsed !== undefined) out[key] = parsed;
      }
      return out;
    }

    case "array": {
      if (!Array.isArray(input)) {
        errors.push(`${path} must be an array`);
        return undefined;
      }
      const item = schema.items;
      if (!item) return input;
      return input.map((entry, i) => walk(item, entry, `${path}[${i}]`, errors));
    }

    case "number": {
      const n = typeof input === "string" ? Number(input) : input;
      if (typeof n !== "number" || Number.isNaN(n)) {
        errors.push(`${path} must be a number`);
        return undefined;
      }
      if (schema.minimum !== undefined && n < schema.minimum) {
        errors.push(`${path} must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && n > schema.maximum) {
        errors.push(`${path} must be <= ${schema.maximum}`);
      }
      return n;
    }

    case "boolean": {
      if (typeof input === "boolean") return input;
      if (input === "true") return true;
      if (input === "false") return false;
      errors.push(`${path} must be a boolean`);
      return undefined;
    }

    case "string": {
      if (typeof input !== "string") {
        errors.push(`${path} must be a string`);
        return undefined;
      }
      if (schema.enum && !schema.enum.includes(input)) {
        errors.push(`${path} must be one of: ${schema.enum.join(", ")}`);
      }
      return input;
    }

    default:
      return input;
  }
}
