import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JsonSchema } from "../../shared/types/mcp.js";
import {
  applyDefaults,
  checkSchema,
  describeIssue,
  validateValue,
  type ValidationIssue,
} from "../../packages/zotero/src/server/validate.js";
import { loadContract } from "../fixtures/fake-registry.js";

const KEY = "^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$";

const schema: JsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    ratio: { type: "number", minimum: 0, maximum: 1 },
    query: { type: "string", minLength: 2, maxLength: 5 },
    key: { type: "string", pattern: KEY },
    mode: { type: "string", enum: ["a", "b"], default: "a" },
    flag: { type: "boolean" },
    tags: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 3, uniqueItems: true },
    nested: { type: "object", properties: { inner: { type: "integer" } }, required: ["inner"], additionalProperties: false },
  },
  required: ["query"],
  additionalProperties: false,
};

function paths(issues: ValidationIssue[]): string[] {
  return issues.map((issue) => issue.path);
}

describe("validateValue", () => {
  it("accepts a valid object", () => {
    const value = { query: "abc", limit: 10, ratio: 0.5, key: "ABCD2345", mode: "b", flag: false, tags: ["x", "y"], nested: { inner: 1 } };
    assert.deepEqual(validateValue(schema, value), []);
  });

  it("reports missing required and unknown properties", () => {
    const issues = validateValue(schema, { extra: 1 });
    assert.deepEqual(paths(issues), ["query", "extra"]);
    assert.equal(issues[0]?.message, "is required");
    assert.equal(issues[1]?.message, "is not an allowed property");
  });

  it("distinguishes integer from number and rejects non-JSON numbers", () => {
    assert.match(validateValue(schema, { query: "abc", limit: 1.5 })[0]?.message ?? "", /must be integer \(got number\)/);
    assert.deepEqual(validateValue(schema, { query: "abc", ratio: 1 }), []);
    assert.equal(validateValue({ type: "number" }, Number.NaN).length, 1);
    assert.equal(validateValue({ type: "number" }, Number.POSITIVE_INFINITY).length, 1);
    assert.match(validateValue(schema, { query: "abc", limit: "5" })[0]?.message ?? "", /got string/);
  });

  it("checks numeric bounds and reports the offending value", () => {
    const [low] = validateValue(schema, { query: "abc", limit: 0 });
    const [high] = validateValue(schema, { query: "abc", limit: 1000 });
    assert.equal(describeIssue(low!), "limit must be >= 1 (got 0)");
    assert.equal(describeIssue(high!), "limit must be <= 200 (got 1000)");
  });

  it("counts string length in code points", () => {
    assert.deepEqual(validateValue(schema, { query: "中文" }), []);
    // Two astral characters are 4 UTF-16 units but 2 code points.
    assert.deepEqual(validateValue(schema, { query: "😀😀" }), []);
    assert.equal(validateValue(schema, { query: "😀" })[0]?.message, "must be at least 2 characters (got 1)");
    assert.equal(validateValue(schema, { query: "abcdef" })[0]?.message, "must be at most 5 characters (got 6)");
  });

  it("applies patterns as unanchored unicode regexes", () => {
    assert.deepEqual(validateValue(schema, { query: "abc", key: "ABCD2345" }), []);
    assert.equal(validateValue(schema, { query: "abc", key: "abcd2345" })[0]?.path, "key");
    assert.equal(validateValue(schema, { query: "abc", key: "ABCD1234" }).length, 1, "1 is not a Zotero key character");
    assert.deepEqual(validateValue({ type: "string", pattern: "b" }, "abc"), []);
    assert.deepEqual(validateValue({ type: "string", pattern: "^.$" }, "😀"), []);
  });

  it("checks enum membership", () => {
    const [issue] = validateValue(schema, { query: "abc", mode: "c" });
    assert.equal(issue?.message, 'must be one of: "a", "b"');
  });

  it("validates arrays: type, size, uniqueness and items", () => {
    assert.equal(validateValue(schema, { query: "abc", tags: [] })[0]?.message, "must have at least 1 items (got 0)");
    assert.equal(validateValue(schema, { query: "abc", tags: ["a", "b", "c", "d"] })[0]?.message, "must have at most 3 items (got 4)");
    assert.equal(validateValue(schema, { query: "abc", tags: ["a", "a"] })[0]?.message, "must not contain duplicates (item 1 repeats item 0)");
    assert.deepEqual(paths(validateValue(schema, { query: "abc", tags: ["a", 2, ""] })), ["tags[1]", "tags[2]"]);
    assert.equal(validateValue(schema, { query: "abc", tags: "a" })[0]?.message, "must be array (got string)");
  });

  it("compares uniqueItems structurally", () => {
    const unique: JsonSchema = { type: "array", uniqueItems: true };
    assert.equal(validateValue(unique, [{ a: 1, b: 2 }, { b: 2, a: 1 }]).length, 1);
    assert.equal(validateValue(unique, [[1, 2], [2, 1]]).length, 0);
    assert.equal(validateValue(unique, [1, "1"]).length, 0);
  });

  it("descends into nested objects", () => {
    assert.deepEqual(paths(validateValue(schema, { query: "abc", nested: { other: 1 } })), ["nested.inner", "nested.other"]);
    assert.equal(validateValue(schema, { query: "abc", nested: [] })[0]?.message, "must be object (got array)");
    assert.equal(validateValue(schema, { query: "abc", nested: null })[0]?.message, "must be object (got null)");
  });

  it("treats __proto__ as an ordinary unknown key", () => {
    const value = JSON.parse('{"query":"abc","__proto__":{"limit":1}}') as Record<string, unknown>;
    assert.deepEqual(paths(validateValue(schema, value)), ["__proto__"]);
  });

  it("caps the number of issues and the length of echoed keys", () => {
    const value: Record<string, unknown> = { query: "abc" };
    for (let i = 0; i < 100; i++) value[`k${i}`] = i;
    value["x".repeat(500)] = 1;
    const issues = validateValue(schema, value);
    assert.equal(issues.length, 20);
    const long = validateValue({ type: "object", additionalProperties: false }, { ["y".repeat(500)]: 1 });
    assert.ok((long[0]?.path.length ?? 0) < 80);
  });

  it("describes root issues as arguments", () => {
    assert.equal(describeIssue(validateValue(schema, [])[0]!), "arguments must be object (got array)");
  });
});

describe("applyDefaults", () => {
  it("fills omitted top-level defaults without overriding provided values", () => {
    const input = { query: "abc", mode: "b" };
    const result = applyDefaults(schema, input);
    assert.deepEqual(result, { query: "abc", mode: "b", limit: 50 });
    assert.deepEqual(input, { query: "abc", mode: "b" }, "input is not mutated");
  });

  it("copies structured defaults so handlers cannot mutate the schema", () => {
    const withArray: JsonSchema = { type: "object", properties: { list: { type: "array", default: ["a"] } } };
    const first = applyDefaults(withArray, {});
    (first["list"] as string[]).push("b");
    assert.deepEqual(applyDefaults(withArray, {})["list"], ["a"]);
  });
});

describe("checkSchema", () => {
  it("accepts every schema in the tool contract", () => {
    for (const tool of loadContract().tools) {
      assert.deepEqual(checkSchema(tool.inputSchema, tool.name), [], tool.name);
    }
  });

  it("rejects unsupported keywords so the validator never silently ignores a constraint", () => {
    const problems = checkSchema({ type: "object", properties: { a: { type: "string", format: "date", oneOf: [] } } });
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? "", /unsupported keyword "format"/);
  });

  it("rejects malformed keyword values", () => {
    const problems = checkSchema({
      type: "object",
      properties: {
        a: { type: "string", pattern: "(" },
        b: { type: "integer", minimum: 5, maximum: 1 },
        c: { type: "string", enum: [] },
        d: { type: "integer", enum: ["x"] },
        e: { type: "list" },
        f: { type: "array", minItems: -1, items: { type: "string", maxLength: 1.5 } },
      },
      required: ["missing"],
      additionalProperties: "no",
    });
    const text = problems.join("\n");
    for (const expected of [
      "pattern is not a valid regular expression",
      "minimum > maximum",
      "enum must be a non-empty array",
      'enum value "x" does not match type integer',
      'unknown type "list"',
      "minItems must be a non-negative integer",
      "maxLength must be a non-negative integer",
      'required property "missing" is not declared',
      "additionalProperties must be a boolean",
    ]) {
      assert.ok(text.includes(expected), `expected problem: ${expected}\n${text}`);
    }
  });

  it("checks defaults against their own schema and only at the top level", () => {
    const problems = checkSchema({
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, default: 0 },
        tags: { type: "array", items: { type: "string", default: "x" } },
      },
    });
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? "", /default value must be >= 1/);
    assert.match(problems[1] ?? "", /default is only supported on top-level properties/);
  });
});
