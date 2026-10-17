/**
 * Host-agnostic MCP / JSON-RPC types shared by the Zotero bridge, tests and build scripts.
 * Only the subset used by a stateless, JSON-only, tools-only server is modelled.
 */

/** Protocol revisions the bridge negotiates, newest first. 2025-11-25 is the baseline. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = "2025-11-25";
/** Version assumed when an HTTP request carries no MCP-Protocol-Version header (per spec). */
export const DEFAULT_HEADERLESS_VERSION: ProtocolVersion = "2025-03-26";

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

/** MCP tool annotations (all optional hints). */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Subset of JSON Schema accepted by the bridge's runtime validator. */
export interface JsonSchema {
  type?: "object" | "string" | "integer" | "number" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  default?: unknown;
  examples?: unknown[];
}

/** A tool as declared in shared/contracts/tools.json and returned by tools/list. */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  annotations: ToolAnnotations;
}

/** Shape of shared/contracts/tools.json. */
export interface ToolContractFile {
  $schema?: string;
  contractVersion: number;
  tools: ToolDefinition[];
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  /** Base64-encoded image bytes. */
  data: string;
  mimeType: string;
}

/**
 * MCP CallToolResult as sent on the wire (no outputSchema/structuredContent). The first content item is always text:
 * the JSON result, the hook JSON or the error payload; text and image items may follow it.
 */
export interface CallToolResult {
  content: [TextContent, ...(TextContent | ImageContent)[]];
  isError?: boolean;
  [key: string]: unknown;
}
