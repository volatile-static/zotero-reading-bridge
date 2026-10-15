/**
 * Binds the tool contract (shared/contracts/tools.json) to handler implementations. Pure: no Zotero globals.
 * Every inconsistency throws at startup, so a bad build fails loudly instead of serving a partial tool list.
 */
import type { ToolContractFile, ToolDefinition } from "../../../../shared/types/mcp.js";
import { TOOL_NAMES, type ToolName } from "../../../../shared/types/tool-names.js";
import { checkSchema } from "../server/validate.js";
import type { ToolHandler, ToolRegistry } from "./types.js";

export function buildRegistry(contract: ToolContractFile, handlers: Record<ToolName, ToolHandler>): ToolRegistry {
  const names = contract.tools.map((tool) => tool.name);
  if (names.length !== TOOL_NAMES.length || names.some((name, index) => name !== TOOL_NAMES[index])) {
    throw new Error(`Tool contract does not match TOOL_NAMES (contract: ${names.join(", ")})`);
  }

  const definitions = new Map<string, ToolDefinition>();
  const bound = new Map<string, ToolHandler>();
  for (const tool of contract.tools) {
    if (tool.inputSchema.type !== "object") {
      throw new Error(`Tool ${tool.name}: inputSchema must have type "object"`);
    }
    const problems = checkSchema(tool.inputSchema, `${tool.name}.inputSchema`);
    if (problems.length > 0) {
      throw new Error(`Tool ${tool.name} has an unsupported input schema: ${problems.join("; ")}`);
    }
    // The handler map is assembled from several modules at runtime; check own keys, not the type.
    const handler: unknown = Object.hasOwn(handlers, tool.name) ? handlers[tool.name as ToolName] : undefined;
    if (typeof handler !== "function") {
      throw new Error(`Tool ${tool.name} has no handler`);
    }
    definitions.set(tool.name, tool);
    bound.set(tool.name, handler as ToolHandler);
  }
  const extra = Object.keys(handlers).filter((name) => !definitions.has(name));
  if (extra.length > 0) {
    throw new Error(`Handlers without a contract entry: ${extra.join(", ")}`);
  }

  const ordered: readonly ToolDefinition[] = Object.freeze([...contract.tools]);
  return {
    definitions: () => ordered,
    definition: (name) => definitions.get(name),
    handler: (name) => bound.get(name),
  };
}
