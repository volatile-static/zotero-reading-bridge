/**
 * Stateless, JSON-only MCP Streamable HTTP handler (protocol 2025-11-25 / 2025-06-18 / 2025-03-26).
 * Pure: no Zotero globals. The Zotero endpoint adapter converts requests/responses; tests drive it directly.
 *
 * Rules (DESIGN.md decisions 5-10, research mcp-spec.md §3-§7):
 *  - no sessions, no SSE: POST only (other methods 405), notifications and responses 202 with no body;
 *  - JSON-RPC errors for well-formed requests travel with HTTP 200, transport problems with 4xx, never 5xx;
 *  - `server/discover` (MCP 2026-07-28 era probe) gets 400 + -32601 echoing the id, which dual-era clients
 *    read as "legacy server" and fall back to initialize;
 *  - tool argument and execution failures are CallToolResult.isError results (SEP-1303).
 */
import { BRIDGE_NAME, BRIDGE_TITLE } from "../../../../shared/types/bridge.js";
import {
  DEFAULT_HEADERLESS_VERSION,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcResponse,
  type ProtocolVersion,
} from "../../../../shared/types/mcp.js";
import type { ToolErrorCode, ToolErrorPayload } from "../../../../shared/types/tools.js";
import { ToolError, type ToolOutput, type ToolRegistry } from "../tools/types.js";
import { sanitizeIdentifier, truncateText } from "../util/text.js";
import { checkAccess } from "./access.js";
import { emptyResponse, jsonResponse, type BridgeHttpResponse } from "./response.js";
import { applyDefaults, describeIssue, validateValue } from "./validate.js";

export type { BridgeHttpResponse } from "./response.js";

export interface BridgeHttpRequest {
  method: string;
  /** Endpoint path without query string (/bridge/mcp or /codex/mcp). */
  path: string;
  /** Request headers with lowercase names. */
  headers: Record<string, string | undefined>;
  /** Parsed JSON when the request was received as application/json; undefined when no usable body exists. */
  body: unknown;
  /** Raw Content-Type header value (parameters allowed), or null when absent. */
  contentType: string | null;
}

export interface McpContext {
  registry: ToolRegistry;
  serverVersion: string;
  instructions: string;
  /** Actual Zotero port for the Host check; null skips the port comparison (tests). */
  port: number | null;
  onEvent?: (event: McpDiagnosticEvent) => void;
}

/** One per HTTP request; carries no request or result content (safe for Zotero debug output). */
export interface McpDiagnosticEvent {
  httpMethod: string;
  rpcMethod: string | null;
  tool: string | null;
  status: number;
  bytes: number;
  ms: number;
  outcome: "ok" | "rpc-error" | "tool-error" | "rejected";
  /** Constructor name of an unexpected exception (never its message). */
  errorType?: string;
}

/** Clients may add the initialize instructions to the system prompt; keep them bounded. */
export const INSTRUCTIONS_MAX_CHARS = 4000;
/** Only 2025-03-26 allows batches and no real client sends them; cap the work one request can queue. */
const MAX_BATCH_SIZE = 32;
const MAX_REPORTED_ISSUES = 10;
/** Implementation-defined JSON-RPC code for transport rejections (avoids -32001 and -32020..-32022). */
const TRANSPORT_ERROR = -32000;

type JsonObject = Record<string, unknown>;
type Outcome = "ok" | "tool-error" | "rpc-error";

interface Trace {
  rpcMethod: string | null;
  tool: string | null;
  outcome: Outcome;
  errorType?: string;
}

const OUTCOME_RANK: Record<Outcome, number> = { ok: 0, "tool-error": 1, "rpc-error": 2 };

function noteOutcome(trace: Trace, outcome: Outcome): void {
  if (OUTCOME_RANK[outcome] > OUTCOME_RANK[trace.outcome]) trace.outcome = outcome;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedVersion(value: string): value is ProtocolVersion {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

function validId(value: unknown): JsonRpcId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

/** Client-supplied text echoed in error messages is clipped. */
function clip(value: string, max = 100): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function rpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function transportError(status: number, code: number, message: string, extraHeaders?: Record<string, string>): BridgeHttpResponse {
  return jsonResponse(status, rpcError(null, code, message), extraHeaders);
}

function unsupportedVersionMessage(version: string): string {
  return `Unsupported protocol version: ${clip(version, 40)} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`;
}

const PROBE_MESSAGE =
  `Method not found: server/discover. This server speaks MCP ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")} via initialize.`;

/** Media ranges that can cover application/json, by specificity (RFC 9110 §12.5.1: the most specific one wins). */
const JSON_RANGE_SPECIFICITY: Readonly<Record<string, number>> = { "application/json": 3, "application/*": 2, "*/*": 1 };

/** The q parameter of a media range (default 1; an unparsable value counts as 1, the lenient reading). */
function rangeQuality(params: readonly string[]): number {
  for (const param of params) {
    const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
    if (match) {
      const q = Number(match[1]);
      return Number.isFinite(q) ? q : 1;
    }
  }
  return 1;
}

/**
 * Lenient: a missing or empty Accept is fine. Otherwise the most specific range covering application/json decides,
 * and q=0 means "not acceptable": `application/json;q=0, *\/*` excludes JSON, `*\/*;q=0, application/json` does not.
 */
function acceptsJson(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === "") return true;
  let specificity = 0;
  let quality = 0;
  for (const range of accept.split(",")) {
    const [type = "", ...params] = range.split(";");
    const rank = JSON_RANGE_SPECIFICITY[type.trim().toLowerCase()] ?? 0;
    if (rank === 0 || rank < specificity) continue;
    const q = rangeQuality(params);
    // A repeated range of the same specificity: keep the most favourable quality.
    quality = rank > specificity ? q : Math.max(quality, q);
    specificity = rank;
  }
  return specificity > 0 && quality > 0;
}

function mediaType(contentType: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

type Classified =
  | { kind: "request"; id: JsonRpcId; method: string; params: unknown }
  /** Notification or response: accepted without a reply. */
  | { kind: "accepted" }
  | { kind: "invalid"; id: JsonRpcId | null; message: string };

type RpcRequest = Extract<Classified, { kind: "request" }>;

function classify(message: unknown): Classified {
  if (!isObject(message)) return { kind: "invalid", id: null, message: "Invalid Request: expected a JSON-RPC message object" };
  const id = validId(message["id"]);
  if (message["jsonrpc"] !== "2.0") return { kind: "invalid", id, message: 'Invalid Request: jsonrpc must be "2.0"' };
  const method = message["method"];
  if (method === undefined) {
    const isResponse = Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"));
    return isResponse ? { kind: "accepted" } : { kind: "invalid", id, message: "Invalid Request: missing method" };
  }
  if (typeof method !== "string") return { kind: "invalid", id, message: "Invalid Request: method must be a string" };
  if (!Object.hasOwn(message, "id")) return { kind: "accepted" };
  // MCP forbids null ids (unlike base JSON-RPC).
  if (id === null) return { kind: "invalid", id: null, message: "Invalid Request: id must be a string or number" };
  return { kind: "request", id, method, params: message["params"] };
}

interface CallContext {
  version: ProtocolVersion;
  req: BridgeHttpRequest;
  ctx: McpContext;
  trace: Trace;
}

function success(id: JsonRpcId, result: JsonObject): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function toolFailure(id: JsonRpcId, code: ToolErrorCode, message: string, details?: Record<string, unknown>): JsonRpcResponse {
  const payload: ToolErrorPayload = { error: details === undefined ? { code, message } : { code, message, details } };
  const result: CallToolResult = { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
  return success(id, result);
}

function toCallToolResult(output: ToolOutput): CallToolResult {
  switch (output.kind) {
    case "text":
      return { content: [{ type: "text", text: output.text }] };
    case "json":
      return { content: [{ type: "text", text: JSON.stringify(output.data) ?? "null" }] };
    default:
      throw new TypeError("Tool handler returned an invalid ToolOutput");
  }
}

/**
 * Exception type only, never the message. A shape test rather than instanceof: errors thrown by Zotero code come
 * from another realm. Only identifier-like names pass, so a thrown object cannot smuggle content into the result.
 */
function errorType(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : typeof error;
}

function initializeResult(params: unknown, ctx: McpContext): JsonObject {
  const requested = isObject(params) ? params["protocolVersion"] : undefined;
  // Echo a supported version; otherwise offer the latest and let the client decide (never an error).
  const protocolVersion = typeof requested === "string" && isSupportedVersion(requested) ? requested : LATEST_PROTOCOL_VERSION;
  const result: JsonObject = {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: BRIDGE_NAME, title: BRIDGE_TITLE, version: ctx.serverVersion },
  };
  const instructions = truncateText(ctx.instructions, INSTRUCTIONS_MAX_CHARS).text;
  if (instructions) result["instructions"] = instructions;
  return result;
}

async function callTool(id: JsonRpcId, params: unknown, call: CallContext): Promise<JsonRpcResponse> {
  const { ctx, trace } = call;
  if (!isObject(params)) return rpcError(id, JSONRPC_INVALID_PARAMS, "Invalid params: tools/call requires a params object");
  const name = params["name"];
  if (typeof name !== "string") return rpcError(id, JSONRPC_INVALID_PARAMS, "Invalid params: name must be a string");
  const definition = ctx.registry.definition(name);
  const handler = ctx.registry.handler(name);
  if (!definition || !handler) return rpcError(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${clip(name)}`);
  trace.tool = definition.name;

  const rawArgs = params["arguments"] === undefined ? {} : params["arguments"];
  if (!isObject(rawArgs)) return rpcError(id, JSONRPC_INVALID_PARAMS, "Invalid params: arguments must be an object");
  const issues = validateValue(definition.inputSchema, rawArgs);
  if (issues.length > 0) {
    const reported = issues.slice(0, MAX_REPORTED_ISSUES);
    return toolFailure(id, "INVALID_ARGUMENT", `Invalid arguments: ${reported.map(describeIssue).join("; ")}`, {
      issues: reported,
    });
  }

  try {
    const output = await handler(applyDefaults(definition.inputSchema, rawArgs), {
      protocolVersion: call.version,
      endpointPath: call.req.path,
    });
    return success(id, toCallToolResult(output));
  } catch (error) {
    if (error instanceof ToolError) return toolFailure(id, error.code, error.message, error.details);
    // Unexpected failure: report only the exception type; its message may quote library content.
    trace.errorType = errorType(error);
    return toolFailure(id, "INTERNAL", `Internal error while running ${definition.name} (${trace.errorType})`);
  }
}

const KNOWN_METHODS: ReadonlySet<string> = new Set(["initialize", "ping", "tools/list", "tools/call"]);

async function dispatch(request: RpcRequest, call: CallContext): Promise<JsonRpcResponse> {
  const { id, method, params } = request;
  // MCP params are objects (JSON-RPC 2.0 §4.2: a structured value when present). A missing or null params counts as
  // "no params"; any other value is rejected rather than silently ignored (it would hide a client bug, e.g. a
  // protocol version passed as a bare string to initialize).
  if (KNOWN_METHODS.has(method) && params !== undefined && params !== null && !isObject(params)) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Invalid params: params must be an object");
  }
  switch (method) {
    case "initialize":
      return success(id, initializeResult(params, call.ctx));
    case "ping":
      return success(id, {});
    case "tools/list":
      // One page holds every tool; a cursor can only be one we never issued, so it is ignored.
      return success(id, { tools: call.ctx.registry.definitions() });
    case "tools/call":
      return callTool(id, params, call);
    default:
      return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${clip(method)}`);
  }
}

async function respond(request: RpcRequest, call: CallContext): Promise<JsonRpcResponse> {
  const response = await dispatch(request, call);
  if ("error" in response) noteOutcome(call.trace, "rpc-error");
  else if (response.result["isError"] === true) noteOutcome(call.trace, "tool-error");
  return response;
}

async function handleBatch(
  batch: unknown[],
  header: string | undefined,
  req: BridgeHttpRequest,
  ctx: McpContext,
  trace: Trace,
): Promise<BridgeHttpResponse> {
  trace.rpcMethod = "batch";
  if (header !== undefined && !isSupportedVersion(header)) {
    return transportError(400, JSONRPC_INVALID_REQUEST, unsupportedVersionMessage(header));
  }
  const version = header ?? DEFAULT_HEADERLESS_VERSION;
  if (version !== "2025-03-26") {
    return transportError(400, JSONRPC_INVALID_REQUEST, `Invalid Request: JSON-RPC batching is not supported in protocol version ${version}`);
  }
  if (batch.length === 0) return transportError(400, JSONRPC_INVALID_REQUEST, "Invalid Request: empty batch");
  if (batch.length > MAX_BATCH_SIZE) {
    return transportError(400, JSONRPC_INVALID_REQUEST, `Invalid Request: batches are limited to ${MAX_BATCH_SIZE} messages`);
  }
  if (batch.some((message) => isObject(message) && message["method"] === "initialize")) {
    return transportError(400, JSONRPC_INVALID_REQUEST, "Invalid Request: initialize must not be part of a batch");
  }

  const call: CallContext = { version, req, ctx, trace };
  const responses: JsonRpcResponse[] = [];
  for (const message of batch) {
    const classified = classify(message);
    if (classified.kind === "request") responses.push(await respond(classified, call));
    else if (classified.kind === "invalid") {
      noteOutcome(trace, "rpc-error");
      responses.push(rpcError(classified.id, JSONRPC_INVALID_REQUEST, classified.message));
    }
  }
  return responses.length > 0 ? jsonResponse(200, responses) : emptyResponse(202);
}

async function handleSingle(
  message: unknown,
  header: string | undefined,
  req: BridgeHttpRequest,
  ctx: McpContext,
  trace: Trace,
): Promise<BridgeHttpResponse> {
  const method = isObject(message) && typeof message["method"] === "string" ? message["method"] : null;
  const id = isObject(message) ? validId(message["id"]) : null;
  trace.rpcMethod = method === null ? null : sanitizeIdentifier(method, 64);

  if (method === "server/discover") {
    return jsonResponse(400, rpcError(id, JSONRPC_METHOD_NOT_FOUND, PROBE_MESSAGE));
  }
  // initialize negotiates from its params; every other request must carry a supported version or none.
  if (method !== "initialize" && header !== undefined && !isSupportedVersion(header)) {
    return jsonResponse(400, rpcError(id, JSONRPC_INVALID_REQUEST, unsupportedVersionMessage(header)));
  }
  const version = header !== undefined && isSupportedVersion(header) ? header : DEFAULT_HEADERLESS_VERSION;

  const classified = classify(message);
  if (classified.kind === "accepted") return emptyResponse(202);
  if (classified.kind === "invalid") {
    return jsonResponse(400, rpcError(classified.id, JSONRPC_INVALID_REQUEST, classified.message));
  }
  return jsonResponse(200, await respond(classified, { version, req, ctx, trace }));
}

async function route(req: BridgeHttpRequest, ctx: McpContext, trace: Trace): Promise<BridgeHttpResponse> {
  const denied = checkAccess(req.headers, ctx.port);
  if (denied) return transportError(denied.status, TRANSPORT_ERROR, denied.message);
  if (req.method !== "POST") {
    return transportError(405, TRANSPORT_ERROR, "Method not allowed: use POST (this server offers no SSE stream and no sessions)", {
      Allow: "POST",
    });
  }
  if (!acceptsJson(req.headers["accept"])) {
    return transportError(406, TRANSPORT_ERROR, "Not Acceptable: the client must accept application/json");
  }
  if (mediaType(req.contentType) !== "application/json") {
    return transportError(415, TRANSPORT_ERROR, "Unsupported Media Type: Content-Type must be application/json");
  }
  if (req.body === undefined) {
    return transportError(400, JSONRPC_PARSE_ERROR, "Parse error: the request body was not received as JSON");
  }

  const header = req.headers["mcp-protocol-version"]?.trim();
  return Array.isArray(req.body)
    ? handleBatch(req.body, header, req, ctx, trace)
    : handleSingle(req.body, header, req, ctx, trace);
}

function emit(ctx: McpContext, event: McpDiagnosticEvent): void {
  try {
    ctx.onEvent?.(event);
  } catch {
    // Diagnostics must never affect the response.
  }
}

/** Handle one HTTP request to the MCP endpoint. Never throws and never answers 5xx. */
export async function handleMcpHttp(req: BridgeHttpRequest, ctx: McpContext): Promise<BridgeHttpResponse> {
  const started = Date.now();
  const trace: Trace = { rpcMethod: null, tool: null, outcome: "ok" };
  let response: BridgeHttpResponse;
  try {
    response = await route(req, ctx, trace);
  } catch (error) {
    // Zotero's own exception path would write a malformed 500; answer a JSON-RPC internal error instead.
    trace.errorType = errorType(error);
    trace.outcome = "rpc-error";
    const id = isObject(req.body) ? validId(req.body["id"]) : null;
    response = jsonResponse(200, rpcError(id, JSONRPC_INTERNAL_ERROR, "Internal error"));
  }
  const event: McpDiagnosticEvent = {
    httpMethod: req.method,
    rpcMethod: trace.rpcMethod,
    tool: trace.tool,
    status: response.status,
    bytes: response.body.length,
    ms: Date.now() - started,
    outcome: response.status >= 400 ? "rejected" : trace.outcome,
  };
  if (trace.errorType !== undefined) event.errorType = trace.errorType;
  emit(ctx, event);
  return response;
}
