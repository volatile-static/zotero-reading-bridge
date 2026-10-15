/**
 * Test doubles for the tool layer: the real contract file bound to fake handlers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ToolContractFile } from "../../shared/types/mcp.js";
import { TOOL_NAMES, type ToolName } from "../../shared/types/tool-names.js";
import { buildRegistry } from "../../packages/zotero/src/tools/registry.js";
import { json, type ToolHandler, type ToolRegistry } from "../../packages/zotero/src/tools/types.js";

export const CONTRACT_PATH = fileURLToPath(new URL("../../shared/contracts/tools.json", import.meta.url));

/** Fresh parse of shared/contracts/tools.json (callers may mutate their copy). */
export function loadContract(): ToolContractFile {
  return JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as ToolContractFile;
}

/** Every handler echoes its tool name, the arguments it received (after defaults) and the call context. */
export function echoHandlers(overrides: Partial<Record<ToolName, ToolHandler>> = {}): Record<ToolName, ToolHandler> {
  const handlers = {} as Record<ToolName, ToolHandler>;
  for (const name of TOOL_NAMES) {
    handlers[name] = overrides[name] ?? (async (args, ctx) => json({ tool: name, args, ctx }));
  }
  return handlers;
}

export function fakeRegistry(overrides: Partial<Record<ToolName, ToolHandler>> = {}): ToolRegistry {
  return buildRegistry(loadContract(), echoHandlers(overrides));
}
