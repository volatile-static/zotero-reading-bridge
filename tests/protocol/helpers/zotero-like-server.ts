/**
 * A Node HTTP server that reproduces the request handling of Zotero's built-in server
 * (chrome/content/zotero/xpcom/server/server.js in Zotero 11.0-beta.1) around our MCP handler, plus a raw
 * socket client for byte-level assertions. Reproduced quirks:
 *  - `HTTP/1.0` status line; reason phrase from Zotero.Server.responseCodes ("undefined" when missing);
 *    headers written verbatim; `Content-Length: 0` added only for empty bodies;
 *  - Host must match /^(?:127\.0\.0\.1|\[::1\]|localhost)(?::[0-9]+)?$/i, else 400 text/plain;
 *  - unknown path 404 text/plain; HEAD/OPTIONS 200 without reaching the endpoint;
 *  - method not in the endpoint's supportedMethods: 400 text/plain;
 *  - any Origin header or a `Mozilla/` User-Agent: connection closed without a response;
 *  - POST/PUT/PATCH without a numeric Content-Length: 400 text/plain;
 *  - Content-Type exactly "application/json" (before any ";"): JSON.parse, failure is 400 text/plain before the
 *    endpoint runs; other types reach the endpoint as raw text or an input stream;
 *  - an exception thrown by the endpoint becomes an empty 500.
 * The request -> BridgeHttpRequest conversion mirrors what the plugin's endpoint adapter must do.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { ENDPOINT_PATHS } from "../../../shared/types/bridge.js";
import {
  handleMcpHttp,
  type BridgeHttpRequest,
  type BridgeHttpResponse,
  type McpDiagnosticEvent,
} from "../../../packages/zotero/src/server/mcp.js";
import type { ToolRegistry } from "../../../packages/zotero/src/tools/types.js";

/** Zotero.Server.responseCodes as shipped (server.js L31-45). */
const ZOTERO_RESPONSE_CODES: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  300: "Multiple Choices",
  304: "Not Modified",
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  412: "Precondition Failed",
  500: "Internal Server Error",
  501: "Not Implemented",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** Reason phrases the plugin adds at startup (DESIGN decision 10). */
const BRIDGE_RESPONSE_CODES: Readonly<Record<number, string>> = {
  202: "Accepted",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  415: "Unsupported Media Type",
};

const HOST_RE = /^(?:127\.0\.0\.1|\[::1\]|localhost)(?::[0-9]+)?$/i;
const PLAIN_TEXT_CONTENT_TYPES = new Set(["text/plain", "application/json", "application/x-www-form-urlencoded"]);
/** The plugin's BridgeEndpoint.supportedMethods. */
const ENDPOINT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** Stand-in for the nsIInputStream Zotero passes for non-text content types. */
const INPUT_STREAM = Symbol("nsIInputStream");

export const TEST_SERVER_VERSION = "0.1.0-test";

export interface ZoteroLikeServerOptions {
  registry: ToolRegistry;
  instructions?: string;
  /** Add the plugin's reason phrases (default true); false shows Zotero's unpatched "undefined" phrases. */
  patchResponseCodes?: boolean;
}

export interface ZoteroLikeServer {
  port: number;
  url(path?: string): string;
  /** Diagnostic events emitted by the handler, one per request that reached it. */
  events: McpDiagnosticEvent[];
  close(): Promise<void>;
}

function generateResponse(
  codes: Readonly<Record<number, string>>,
  status: number,
  contentTypeOrHeaders?: string | Record<string, string>,
  body?: string,
): string {
  let response = `HTTP/1.0 ${status} ${codes[status]}\r\n`;
  response += "X-Zotero-Version: 11.0-beta.1-test\r\n";
  response += "X-Zotero-Connector-API-Version: 3\r\n";
  const headers = typeof contentTypeOrHeaders === "string" ? { "Content-Type": contentTypeOrHeaders } : contentTypeOrHeaders;
  for (const [name, value] of Object.entries(headers ?? {})) response += `${name}: ${value}\r\n`;
  response += body ? `\r\n${body}` : "Content-Length: 0\r\n\r\n";
  return response;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startZoteroLikeServer(options: ZoteroLikeServerOptions): Promise<ZoteroLikeServer> {
  const codes = options.patchResponseCodes === false ? ZOTERO_RESPONSE_CODES : { ...ZOTERO_RESPONSE_CODES, ...BRIDGE_RESPONSE_CODES };
  const events: McpDiagnosticEvent[] = [];
  let port = 0;

  async function handle(req: http.IncomingMessage): Promise<string | null> {
    const raw = await readBody(req);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    const method = req.method ?? "GET";

    const host = headers["host"];
    if (!host || !HOST_RE.test(host)) return generateResponse(codes, 400, "text/plain", "Invalid Host header\n");

    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    if (!(ENDPOINT_PATHS as readonly string[]).includes(pathname)) {
      return generateResponse(codes, 404, "text/plain", "No endpoint found\n");
    }
    const contentType = headers["content-type"]?.split(/\s*;/)[0];

    if (method === "HEAD" || method === "OPTIONS") return generateResponse(codes, 200);
    let postData: string | null = null;
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      const length = /^([0-9]+)$/.exec(headers["content-length"] ?? "");
      if (!length) {
        if (method !== "DELETE") return generateResponse(codes, 400, "text/plain", "Content-length not provided\n");
      } else if (Number(length[1]) > 0 && contentType !== undefined && PLAIN_TEXT_CONTENT_TYPES.has(contentType)) {
        postData = raw.toString("utf8");
      }
    } else if (method !== "GET") {
      return generateResponse(codes, 501, "text/plain", "Method not implemented\n");
    }

    // _processEndpoint
    if (!ENDPOINT_METHODS.includes(method)) {
      return generateResponse(codes, 400, "text/plain", "Endpoint does not support method\n");
    }
    const isBrowser = (headers["user-agent"]?.startsWith("Mozilla/") ?? false) || "origin" in headers;
    if (isBrowser && !headers["x-zotero-connector-api-version"] && !headers["zotero-allowed-request"]) {
      return null;
    }
    let data: unknown = null;
    if (method !== "GET" && contentType) {
      if (contentType === "application/json") {
        try {
          // Zotero passes null for an empty body; JSON.parse(null) parses "null".
          data = JSON.parse(postData as string);
        } catch {
          return generateResponse(codes, 400, "text/plain", "Invalid JSON provided\n");
        }
      } else {
        data = postData ?? INPUT_STREAM;
      }
    }

    const request: BridgeHttpRequest = {
      method,
      path: pathname,
      headers,
      body: contentType === "application/json" ? data : undefined,
      contentType: headers["content-type"] ?? null,
    };
    let response: BridgeHttpResponse;
    try {
      response = await handleMcpHttp(request, {
        registry: options.registry,
        serverVersion: TEST_SERVER_VERSION,
        instructions: options.instructions ?? "Test instructions.",
        port,
        onEvent: (event) => events.push(event),
      });
    } catch {
      // server.js L516-519: _generateResponse(500) without a body.
      return generateResponse(codes, 500);
    }
    return generateResponse(codes, response.status, response.headers, response.body);
  }

  const server = http.createServer({ requireHostHeader: false }, (req) => {
    const socket = req.socket;
    handle(req).then(
      (text) => {
        // Zotero seizes the raw response stream: write the bytes ourselves, then close.
        if (text === null) socket.destroy();
        else socket.end(Buffer.from(text, "utf8"));
      },
      () => socket.destroy(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;

  return {
    port,
    url: (path = ENDPOINT_PATHS[0]) => `http://127.0.0.1:${port}${path}`,
    events,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface RawRequest {
  method?: string;
  path?: string;
  /** Header lines in order. Host defaults to 127.0.0.1:<port>; pass host: null to omit it. */
  headers?: Record<string, string | null>;
  body?: string;
  /** Send the body chunked instead of with Content-Length. */
  chunked?: boolean;
}

export interface RawResponse {
  /** True when the server closed the connection without sending anything. */
  dropped: boolean;
  statusLine: string;
  status: number;
  /** Header lines exactly as received. */
  headerLines: string[];
  /** Lowercased header name -> value (last wins). */
  headers: Record<string, string>;
  body: string;
  bodyBytes: number;
}

/** Send one HTTP/1.1 request over a fresh socket and read until the server closes it. */
export function rawRequest(port: number, request: RawRequest): Promise<RawResponse> {
  const method = request.method ?? "POST";
  const headerMap: Record<string, string | null> = { Host: `127.0.0.1:${port}`, ...request.headers };
  if (request.headers && "host" in request.headers) delete headerMap["Host"];
  const bodyBuffer = request.body === undefined ? null : Buffer.from(request.body, "utf8");

  let head = `${method} ${request.path ?? ENDPOINT_PATHS[0]} HTTP/1.1\r\n`;
  for (const [name, value] of Object.entries(headerMap)) {
    if (value !== null) head += `${name}: ${value}\r\n`;
  }
  let payload: Buffer = Buffer.alloc(0);
  if (bodyBuffer) {
    if (request.chunked) {
      head += "Transfer-Encoding: chunked\r\n";
      payload = Buffer.concat([
        Buffer.from(`${bodyBuffer.length.toString(16)}\r\n`),
        bodyBuffer,
        Buffer.from("\r\n0\r\n\r\n"),
      ]);
    } else {
      head += `Content-Length: ${bodyBuffer.length}\r\n`;
      payload = bodyBuffer;
    }
  }
  head += "Connection: close\r\n\r\n";

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.connect(port, "127.0.0.1", () => socket.end(Buffer.concat([Buffer.from(head), payload])));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("close", () => {
      const raw = Buffer.concat(chunks);
      const split = raw.indexOf("\r\n\r\n");
      if (raw.length === 0 || split < 0) {
        resolve({ dropped: raw.length === 0, statusLine: "", status: 0, headerLines: [], headers: {}, body: "", bodyBytes: 0 });
        return;
      }
      const [statusLine = "", ...headerLines] = raw.subarray(0, split).toString("latin1").split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const colon = line.indexOf(":");
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      const bodyBuffer = raw.subarray(split + 4);
      resolve({
        dropped: false,
        statusLine,
        status: Number(statusLine.split(" ")[1]),
        headerLines,
        headers,
        body: bodyBuffer.toString("utf8"),
        bodyBytes: bodyBuffer.length,
      });
    });
  });
}

export interface PostOptions {
  path?: string;
  headers?: Record<string, string>;
}

/** POST a JSON-RPC payload with the headers MCP clients send; returns status, headers and parsed body. */
export async function postJson(
  server: ZoteroLikeServer,
  payload: unknown,
  options: PostOptions = {},
): Promise<{ status: number; headers: Headers; text: string; json: any }> {
  const response = await fetch(server.url(options.path), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...options.headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: response.status, headers: response.headers, text, json: parsed };
}
