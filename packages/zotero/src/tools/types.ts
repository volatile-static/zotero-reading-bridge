/**
 * Host-agnostic tool handler plumbing. Must not reference Zotero globals: imported by protocol tests in Node.
 */
import type { ImageContent, TextContent, ToolDefinition, ToolErrorCode } from "../../../../shared/types/index.js";

export interface ToolCallContext {
  /** Negotiated (or header-derived) MCP protocol version of the request. */
  protocolVersion: string;
  /** Endpoint path the request arrived on (/bridge/mcp). */
  endpointPath: string;
}

/** Content items a JSON result may carry after its JSON text: a long document body, annotation images. */
export type ExtraContent = TextContent | ImageContent;

/**
 * What a handler produces. JSON is serialized compactly into the first text content item; `extra` items follow it,
 * so a client that ignores them still gets the complete JSON (which says what each extra item is).
 */
export type ToolOutput =
  | { kind: "json"; data: unknown; extra?: readonly ExtraContent[] }
  /** Raw text, sent verbatim as the single text content item (used for hook JSON). */
  | { kind: "text"; text: string };

export type ToolArgs = Record<string, unknown>;

export type ToolHandler = (args: ToolArgs, ctx: ToolCallContext) => Promise<ToolOutput>;

/** Expected, user-facing failure. Converted to a CallToolResult with isError: true. */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ToolErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export interface ToolRegistry {
  /** Definitions in contract order (served by tools/list). */
  definitions(): readonly ToolDefinition[];
  definition(name: string): ToolDefinition | undefined;
  handler(name: string): ToolHandler | undefined;
}

export function json(data: unknown, extra?: readonly ExtraContent[]): ToolOutput {
  return extra && extra.length > 0 ? { kind: "json", data, extra } : { kind: "json", data };
}

export function text(value: string): ToolOutput {
  return { kind: "text", text: value };
}
