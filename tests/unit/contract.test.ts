import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JsonSchema } from "../../shared/types/mcp.js";
import { TOOL_NAMES } from "../../shared/types/tool-names.js";
import { checkSchema, validateValue } from "../../packages/zotero/src/server/validate.js";
import { loadContract } from "../fixtures/fake-registry.js";

const contract = loadContract();
const ZOTERO_KEY_PATTERN = "^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$";

function walk(schema: JsonSchema, visit: (node: JsonSchema, path: string) => void, path = "inputSchema"): void {
  visit(schema, path);
  for (const [key, sub] of Object.entries(schema.properties ?? {})) walk(sub, visit, `${path}.${key}`);
  if (schema.items) walk(schema.items, visit, `${path}.items`);
}

describe("shared/contracts/tools.json", () => {
  it("has contract version 1 and only known top-level keys", () => {
    assert.equal(contract.contractVersion, 1);
    assert.deepEqual(Object.keys(contract).sort(), ["contractVersion", "tools"]);
  });

  it("lists exactly TOOL_NAMES, in order", () => {
    assert.deepEqual(
      contract.tools.map((tool) => tool.name),
      [...TOOL_NAMES],
    );
  });

  it("uses short, client-safe tool names", () => {
    for (const tool of contract.tools) assert.match(tool.name, /^[a-z][a-z0-9_]{0,63}$/, tool.name);
  });

  for (const tool of contract.tools) {
    describe(tool.name, () => {
      it("declares only the fields served by tools/list (no outputSchema)", () => {
        assert.deepEqual(Object.keys(tool).sort(), ["annotations", "description", "inputSchema", "name", "title"]);
      });

      it("has a title and a description", () => {
        assert.ok(tool.title.trim().length > 0);
        assert.ok(tool.description.trim().length >= 40, "description should tell the model when to use the tool");
        assert.equal(tool.annotations.title, tool.title);
      });

      it("is annotated read-only and non-destructive", () => {
        assert.equal(tool.annotations.readOnlyHint, true);
        assert.equal(tool.annotations.destructiveHint, false);
        assert.equal(tool.annotations.openWorldHint, false);
        assert.equal(typeof tool.annotations.idempotentHint, "boolean");
      });

      it("has a closed object input schema the validator can enforce", () => {
        assert.equal(tool.inputSchema.type, "object");
        assert.equal(tool.inputSchema.additionalProperties, false);
        assert.deepEqual(checkSchema(tool.inputSchema, tool.name), []);
      });

      it("accepts an empty argument object unless something is required", () => {
        const issues = validateValue(tool.inputSchema, {});
        assert.deepEqual(
          issues.map((issue) => issue.path),
          tool.inputSchema.required ?? [],
        );
      });

      it("uses consistent key and pagination parameters", () => {
        walk(tool.inputSchema, (node, path) => {
          if (/\.(key|parentKey|collectionKey)$/.test(path)) assert.equal(node.pattern, ZOTERO_KEY_PATTERN, path);
          if (path.endsWith(".keys.items")) assert.equal(node.pattern, ZOTERO_KEY_PATTERN, path);
          if (path.endsWith(".libraryID")) assert.deepEqual([node.type, node.minimum], ["integer", 1], path);
          if (path.endsWith(".limit")) assert.deepEqual([node.type, node.minimum, node.maximum, node.default], ["integer", 1, 200, 50], path);
          if (path.endsWith(".cursor")) assert.deepEqual([node.type, node.maxLength], ["string", 64], path);
        });
      });
    });
  }
});
