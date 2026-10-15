import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolContractFile } from "../../shared/types/mcp.js";
import { TOOL_NAMES, type ToolName } from "../../shared/types/tool-names.js";
import { buildRegistry } from "../../packages/zotero/src/tools/registry.js";
import type { ToolHandler } from "../../packages/zotero/src/tools/types.js";
import { echoHandlers, loadContract } from "../fixtures/fake-registry.js";

describe("buildRegistry", () => {
  it("serves the contract in order and binds each handler", async () => {
    const handlers = echoHandlers();
    const registry = buildRegistry(loadContract(), handlers);
    assert.deepEqual(
      registry.definitions().map((tool) => tool.name),
      [...TOOL_NAMES],
    );
    for (const name of TOOL_NAMES) {
      assert.equal(registry.definition(name)?.name, name);
      assert.equal(registry.handler(name), handlers[name]);
    }
    assert.ok(Object.isFrozen(registry.definitions()));
  });

  it("returns undefined for unknown names, including Object.prototype keys", () => {
    const registry = buildRegistry(loadContract(), echoHandlers());
    for (const name of ["nope", "constructor", "__proto__", "toString", "hasOwnProperty", ""]) {
      assert.equal(registry.definition(name), undefined, name);
      assert.equal(registry.handler(name), undefined, name);
    }
  });

  it("throws when a contract tool has no handler", () => {
    const handlers: Partial<Record<ToolName, ToolHandler>> = echoHandlers();
    delete handlers.get_schema;
    assert.throws(() => buildRegistry(loadContract(), handlers as Record<ToolName, ToolHandler>), /get_schema has no handler/);
  });

  it("throws when a handler is not a function", () => {
    const handlers = { ...echoHandlers(), get_status: "nope" } as unknown as Record<ToolName, ToolHandler>;
    assert.throws(() => buildRegistry(loadContract(), handlers), /get_status has no handler/);
  });

  it("throws when a handler has no contract entry", () => {
    const handlers = { ...echoHandlers(), delete_items: echoHandlers().get_status } as Record<ToolName, ToolHandler>;
    assert.throws(() => buildRegistry(loadContract(), handlers), /without a contract entry: delete_items/);
  });

  it("throws when contract names diverge from TOOL_NAMES", () => {
    const renamed = loadContract();
    renamed.tools[0]!.name = "get_status_v2";
    assert.throws(() => buildRegistry(renamed, echoHandlers()), /does not match TOOL_NAMES/);

    const reordered = loadContract();
    reordered.tools.reverse();
    assert.throws(() => buildRegistry(reordered, echoHandlers()), /does not match TOOL_NAMES/);

    const missing: ToolContractFile = { ...loadContract(), tools: loadContract().tools.slice(1) };
    assert.throws(() => buildRegistry(missing, echoHandlers()), /does not match TOOL_NAMES/);
  });

  it("throws on input schemas the validator cannot enforce", () => {
    const contract = loadContract();
    (contract.tools[1]!.inputSchema.properties!["maxTextLength"] as Record<string, unknown>)["format"] = "int32";
    assert.throws(() => buildRegistry(contract, echoHandlers()), /get_current_context has an unsupported input schema/);

    const notObject = loadContract();
    (notObject.tools[0]!.inputSchema as { type: string }).type = "array";
    assert.throws(() => buildRegistry(notObject, echoHandlers()), /inputSchema must have type "object"/);
  });
});
