/**
 * Adapter between Zotero's built-in HTTP server (xpcom/server/server.js) and the host-agnostic MCP handler:
 * endpoint registration, request/response conversion, reason-phrase patching, loopback verification and
 * privacy-preserving diagnostics. Zotero sandbox only.
 */
import { ENDPOINT_PATHS } from "../../../../shared/types/bridge.js";
import { JSONRPC_INTERNAL_ERROR, type JsonRpcId } from "../../../../shared/types/mcp.js";
import { TOOL_NAMES } from "../../../../shared/types/tool-names.js";
import type { ToolRegistry } from "../tools/types.js";
import {
  handleMcpHttp,
  type BridgeHttpRequest,
  type BridgeHttpResponse,
  type McpContext,
  type McpDiagnosticEvent,
} from "./mcp.js";
import { loopbackSourcesVerified } from "./loopback.js";
import { jsonResponse } from "./response.js";

const LOG_PREFIX = "[Zotero AI Bridge]";

/** The single argument Zotero passes to a one-parameter endpoint init() (server.js `_processEndpoint`). */
interface ZoteroEndpointRequest {
  method: string;
  pathname: string;
  /** Zotero.Server.Headers proxy: names were lowercased when stored. */
  headers: Record<string, unknown>;
  /** Parsed JSON for application/json; a string, form object, multipart parts, nsIInputStream or null otherwise. */
  data: unknown;
}

/** [status, headers, body, options] as spread into Zotero's sendResponseCallback. */
type ZoteroEndpointResult = [number, Record<string, string>, string, { logFilter: (raw: string) => string }];

export interface EndpointOptions {
  registry: ToolRegistry;
  serverVersion: string;
  instructions: string;
  /** Actual Zotero server port, used by the Host header check. */
  port: number;
}

export interface EndpointRegistration {
  readonly paths: readonly string[];
  /** Remove our endpoints, leaving any path that something else has taken over since. */
  unregister(): void;
}

/**
 * Register the MCP endpoint class under every bridge path. Zotero reads Zotero.Server.Endpoints per request,
 * so this takes effect immediately and needs no server restart.
 */
export function registerEndpoints(options: EndpointOptions): EndpointRegistration {
  const context: McpContext = { ...options, onEvent: logRequest };

  // Zotero instantiates the class per request and picks the calling convention by init.length, so init must
  // declare exactly one parameter (no default or rest). GET/PUT/PATCH/DELETE are listed so our handler answers
  // 405 itself instead of Zotero's 400; "*" lets it answer 415 for non-JSON bodies. No CORS opt-in: Zotero keeps
  // dropping requests that carry Origin or a Mozilla/ User-Agent.
  class ZoteroAIBridgeEndpoint {
    supportedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    supportedDataTypes = "*";

    init(request: ZoteroEndpointRequest): Promise<ZoteroEndpointResult> {
      return respond(request, context);
    }
  }

  const endpoints = Zotero.Server.Endpoints;
  for (const path of ENDPOINT_PATHS) {
    if (endpoints[path] !== undefined) {
      Zotero.warn(new Error(`${LOG_PREFIX} replacing an existing endpoint at ${path}`));
    }
    endpoints[path] = ZoteroAIBridgeEndpoint;
  }
  return {
    paths: ENDPOINT_PATHS,
    unregister() {
      for (const path of ENDPOINT_PATHS) {
        if (endpoints[path] === ZoteroAIBridgeEndpoint) delete endpoints[path];
      }
    },
  };
}

/**
 * Never rejects: Zotero answers a rejected init() with a malformed, bodiless 500, so any failure (including in
 * the request conversion) becomes HTTP 200 + JSON-RPC -32603 instead.
 */
async function respond(request: ZoteroEndpointRequest, context: McpContext): Promise<ZoteroEndpointResult> {
  let body: unknown;
  try {
    const bridgeRequest = toBridgeRequest(request);
    body = bridgeRequest.body;
    return toZoteroResult(await handleMcpHttp(bridgeRequest, context));
  } catch (e) {
    Zotero.debug(`${LOG_PREFIX} unexpected ${errorName(e)} while handling a request`);
    return toZoteroResult(internalErrorResponse(body));
  }
}

function toBridgeRequest(request: ZoteroEndpointRequest): BridgeHttpRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[name.toLowerCase()] = value;
  }
  const contentType = headers["content-type"] ?? null;
  // Zotero JSON-parses the body only when its own, case-sensitive media type is exactly application/json;
  // anything else (strings, form objects, raw input streams) is not a usable MCP body.
  const zoteroParsedJson = contentType?.split(/\s*;/)[0] === "application/json";
  return {
    method: request.method,
    path: request.pathname,
    headers,
    body: zoteroParsedJson ? request.data : undefined,
    contentType,
  };
}

function toZoteroResult(response: BridgeHttpResponse): ZoteroEndpointResult {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    // Zotero writes "Content-Length: 0" itself for an empty body; a second copy would be a duplicate header.
    if (response.body === "" && name.toLowerCase() === "content-length") continue;
    headers[name] = value;
  }
  // Zotero logs the whole raw response when debug output is on; log only status and size instead.
  const summary = `${LOG_PREFIX} response ${response.status} (${utf8Length(response.body)} bytes, body redacted)`;
  return [response.status, headers, response.body, { logFilter: () => summary }];
}

function internalErrorResponse(body: unknown): BridgeHttpResponse {
  return jsonResponse(200, {
    jsonrpc: "2.0",
    id: requestId(body),
    error: { code: JSONRPC_INTERNAL_ERROR, message: "Internal error" },
  });
}

/** Echo the id of a single JSON-RPC request (parsed JSON body) so the client can match the error; else null. */
function requestId(body: unknown): JsonRpcId | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Exception type only. Shape test, not instanceof: errors raised by Zotero code belong to another realm. */
function errorName(e: unknown): string {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  return typeof name === "string" && SAFE_NAME.test(name) ? name : typeof e;
}

const SAFE_HTTP_METHOD = /^[A-Z]{1,10}$/;
const SAFE_NAME = /^[A-Za-z0-9_./-]{1,64}$/;
const KNOWN_TOOLS: ReadonlySet<string> = new Set(TOOL_NAMES);

/**
 * One debug line per request with method, JSON-RPC method, tool, status, size, duration and (for unexpected
 * failures) the exception type only: never arguments or results. Client-supplied names are logged only when
 * they look like the identifiers we expect.
 */
function logRequest(event: McpDiagnosticEvent): void {
  const http = SAFE_HTTP_METHOD.test(event.httpMethod) ? event.httpMethod : "(other)";
  const rpc = event.rpcMethod === null ? "-" : SAFE_NAME.test(event.rpcMethod) ? event.rpcMethod : "(other)";
  const tool = event.tool === null ? "" : ` ${KNOWN_TOOLS.has(event.tool) ? event.tool : "(unknown tool)"}`;
  const failure = event.errorType !== undefined && SAFE_NAME.test(event.errorType) ? ` [${event.errorType}]` : "";
  Zotero.debug(
    `${LOG_PREFIX} ${http} ${rpc}${tool} -> ${event.status} ${event.outcome}${failure} (${event.bytes} bytes, ${event.ms} ms)`,
  );
}

/** Reason phrases Zotero's table lacks; without them the status line reads e.g. "HTTP/1.0 202 undefined". */
const EXTRA_REASON_PHRASES: ReadonlyArray<readonly [number, string]> = [
  [202, "Accepted"],
  [405, "Method Not Allowed"],
  [406, "Not Acceptable"],
  [415, "Unsupported Media Type"],
];

/** Add missing reason phrases; the returned function removes only the ones we added that still hold our value. */
export function patchResponseCodes(): () => void {
  // zotero-types declares responseCodes with fixed literal keys; at runtime it is a plain mutable object.
  const codes = Zotero.Server.responseCodes as unknown as Record<number, string | undefined>;
  const added = EXTRA_REASON_PHRASES.filter(([status]) => codes[status] === undefined);
  for (const [status, phrase] of added) codes[status] = phrase;
  return () => {
    for (const [status, phrase] of added) {
      if (codes[status] === phrase) delete codes[status];
    }
  };
}

/** Actual server port, or null when Zotero's HTTP server is off or failed to bind. */
export function readServerPort(): number | null {
  try {
    const port = Zotero.Server.port;
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Zotero exposes no bind address, so verify the code path instead (rules in loopback.ts). Function sources are
 * available because Zotero ships with javascript.options.discardSystemSource = false. Any doubt fails closed
 * (endpoints stay unregistered).
 */
export function verifyLoopbackBinding(): boolean {
  try {
    const initSource = Function.prototype.toString.call(Zotero.Server.init);
    const httpd = ChromeUtils.importESModule("chrome://remote/content/server/httpd.sys.mjs") as {
      HttpServer?: { prototype?: { start?: unknown } };
    };
    const start = httpd.HttpServer?.prototype?.start;
    return typeof start === "function" && loopbackSourcesVerified(initSource, Function.prototype.toString.call(start));
  } catch {
    return false;
  }
}
