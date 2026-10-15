/**
 * Runtime validator for the JSON Schema subset used by tool input schemas (shared/types/mcp.ts JsonSchema).
 * Pure: no Zotero globals. Keyword semantics follow JSON Schema 2020-12 for the supported subset.
 */
import type { JsonSchema } from "../../../../shared/types/mcp.js";

export interface ValidationIssue {
  /** Location in the arguments object: "" (root), "limit", "tags[2]", ... */
  path: string;
  message: string;
}

/** Bounds the error report for hostile inputs (e.g. thousands of unknown keys). */
const MAX_ISSUES = 20;
/** Keys from the request are echoed in paths; keep them short. */
const MAX_KEY_CHARS = 64;

const KEYWORDS: ReadonlySet<string> = new Set<keyof JsonSchema>([
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
  "examples",
]);

const TYPES: ReadonlySet<string> = new Set(["object", "string", "integer", "number", "boolean", "array", "null"]);

const patternCache = new Map<string, RegExp>();

function compilePattern(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    // JSON Schema patterns are ECMA-262 regexes, unanchored; "u" makes them code-point aware.
    re = new RegExp(pattern, "u");
    patternCache.set(pattern, re);
  }
  return re;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(type: NonNullable<JsonSchema["type"]>, value: unknown): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    default:
      return jsonType(value) === type;
  }
}

/** minLength/maxLength count Unicode code points, not UTF-16 units. */
function codePointLength(value: string): number {
  let length = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    length++;
  }
  return length;
}

/** Key-order-independent serialization for uniqueItems equality. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function childPath(path: string, key: string): string {
  const shown = key.length > MAX_KEY_CHARS ? `${key.slice(0, MAX_KEY_CHARS)}...` : key;
  return path ? `${path}.${shown}` : shown;
}

function visit(schema: JsonSchema, value: unknown, path: string, issues: ValidationIssue[]): void {
  const report = (message: string, at = path) => {
    if (issues.length < MAX_ISSUES) issues.push({ path: at, message });
  };

  if (schema.type !== undefined && !matchesType(schema.type, value)) {
    report(`must be ${schema.type} (got ${jsonType(value)})`);
    return;
  }
  if (schema.enum !== undefined && !schema.enum.some((option) => option === value)) {
    report(`must be one of: ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) report(`must be >= ${schema.minimum} (got ${value})`);
    if (schema.maximum !== undefined && value > schema.maximum) report(`must be <= ${schema.maximum} (got ${value})`);
  } else if (typeof value === "string") {
    if (schema.minLength !== undefined || schema.maxLength !== undefined) {
      const length = codePointLength(value);
      if (schema.minLength !== undefined && length < schema.minLength) {
        report(`must be at least ${schema.minLength} characters (got ${length})`);
      }
      if (schema.maxLength !== undefined && length > schema.maxLength) {
        report(`must be at most ${schema.maxLength} characters (got ${length})`);
      }
    }
    if (schema.pattern !== undefined && !compilePattern(schema.pattern).test(value)) {
      report(`must match pattern ${schema.pattern}`);
    }
  } else if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      report(`must have at least ${schema.minItems} items (got ${value.length})`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      report(`must have at most ${schema.maxItems} items (got ${value.length})`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Map<string, number>();
      value.forEach((item, index) => {
        const key = canonical(item);
        const first = seen.get(key);
        if (first === undefined) seen.set(key, index);
        else report(`must not contain duplicates (item ${index} repeats item ${first})`);
      });
    }
    if (schema.items !== undefined) {
      const itemSchema = schema.items;
      value.forEach((item, index) => visit(itemSchema, item, `${path}[${index}]`, issues));
    }
  } else if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) report("is required", childPath(path, key));
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (propertySchema !== undefined) visit(propertySchema, item, childPath(path, key), issues);
      else if (schema.additionalProperties === false) report("is not an allowed property", childPath(path, key));
    }
  }
}

/** Validate `value` against `schema`; returns at most MAX_ISSUES issues (empty = valid). */
export function validateValue(schema: JsonSchema, value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  visit(schema, value, "", issues);
  return issues;
}

export function describeIssue(issue: ValidationIssue): string {
  return `${issue.path || "arguments"} ${issue.message}`;
}

/**
 * Fill in `default` values of top-level properties the caller omitted. Returns a new object; defaults are
 * copied so handlers can never mutate the shared schema. Only top-level defaults exist (checkSchema enforces it).
 */
export function applyDefaults(schema: JsonSchema, args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...args };
  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (propertySchema.default !== undefined && !Object.hasOwn(result, key)) {
      const value = propertySchema.default;
      result[key] = typeof value === "object" && value !== null ? JSON.parse(JSON.stringify(value)) : value;
    }
  }
  return result;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function checkAt(schema: unknown, path: string, depth: number, problems: string[]): void {
  if (!isPlainObject(schema)) {
    problems.push(`${path}: schema must be an object`);
    return;
  }
  const before = problems.length;
  for (const keyword of Object.keys(schema)) {
    if (!KEYWORDS.has(keyword)) problems.push(`${path}: unsupported keyword "${keyword}"`);
  }
  const s = schema as JsonSchema;
  if (s.type !== undefined && !TYPES.has(s.type)) problems.push(`${path}: unknown type "${String(s.type)}"`);
  if (s.description !== undefined && typeof s.description !== "string") problems.push(`${path}: description must be a string`);
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== "boolean") {
    problems.push(`${path}: additionalProperties must be a boolean`);
  }
  if (s.uniqueItems !== undefined && typeof s.uniqueItems !== "boolean") problems.push(`${path}: uniqueItems must be a boolean`);

  for (const keyword of ["minimum", "maximum"] as const) {
    const bound = s[keyword];
    if (bound !== undefined && !(typeof bound === "number" && Number.isFinite(bound))) {
      problems.push(`${path}: ${keyword} must be a finite number`);
    }
  }
  for (const keyword of ["minLength", "maxLength", "minItems", "maxItems"] as const) {
    if (s[keyword] !== undefined && !isNonNegativeInteger(s[keyword])) {
      problems.push(`${path}: ${keyword} must be a non-negative integer`);
    }
  }
  for (const [low, high] of [["minimum", "maximum"], ["minLength", "maxLength"], ["minItems", "maxItems"]] as const) {
    const lo = s[low];
    const hi = s[high];
    if (typeof lo === "number" && typeof hi === "number" && lo > hi) problems.push(`${path}: ${low} > ${high}`);
  }

  if (s.pattern !== undefined) {
    if (typeof s.pattern !== "string") problems.push(`${path}: pattern must be a string`);
    else {
      try {
        compilePattern(s.pattern);
      } catch {
        problems.push(`${path}: pattern is not a valid regular expression`);
      }
    }
  }
  if (s.enum !== undefined) {
    if (!Array.isArray(s.enum) || s.enum.length === 0) problems.push(`${path}: enum must be a non-empty array`);
    else {
      const type = s.type;
      for (const option of s.enum) {
        if (!["string", "number", "boolean"].includes(typeof option)) problems.push(`${path}: enum values must be primitives`);
        else if (type !== undefined && !matchesType(type, option)) {
          problems.push(`${path}: enum value ${JSON.stringify(option)} does not match type ${type}`);
        }
      }
    }
  }

  if (s.properties !== undefined) {
    if (!isPlainObject(s.properties)) problems.push(`${path}: properties must be an object`);
    else {
      for (const [key, sub] of Object.entries(s.properties)) checkAt(sub, `${path}.properties.${key}`, depth + 1, problems);
    }
  }
  if (s.required !== undefined) {
    if (!Array.isArray(s.required) || !s.required.every((key) => typeof key === "string")) {
      problems.push(`${path}: required must be an array of strings`);
    } else {
      for (const key of s.required) {
        if (!s.properties || !Object.hasOwn(s.properties, key)) problems.push(`${path}: required property "${key}" is not declared`);
      }
    }
  }
  if (s.items !== undefined) checkAt(s.items, `${path}.items`, depth + 1, problems);

  if (s.default !== undefined) {
    // applyDefaults only fills top-level properties; a default anywhere else would be silently ignored.
    if (depth !== 1) problems.push(`${path}: default is only supported on top-level properties`);
    // Validating against a malformed schema could throw (bad pattern), so only check defaults of sound schemas.
    if (problems.length === before) {
      const { default: value, ...rest } = s;
      for (const issue of validateValue(rest, value)) {
        problems.push(`${path}: default ${describeIssue({ ...issue, path: issue.path || "value" })}`);
      }
    }
  }
}

/**
 * Check that a schema only uses the supported keywords with well-formed values, so the validator enforces
 * everything the schema promises. Returns a list of problems (empty = usable).
 */
export function checkSchema(schema: unknown, path = "schema"): string[] {
  const problems: string[] = [];
  checkAt(schema, path, 0, problems);
  return problems;
}
