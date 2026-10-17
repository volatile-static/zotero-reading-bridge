/**
 * stdio <-> HTTP relay for Claude Desktop, whose local MCP servers and extensions (.mcpb) can only be stdio commands.
 *
 * Reads newline-delimited JSON-RPC from `input`, POSTs each line unchanged to http://127.0.0.1:<port>/bridge/mcp and
 * writes each JSON response as one line to `output` (202 without a body writes nothing). Protocol handling stays in
 * the Zotero plugin; the relay only frames messages and turns transport failures into JSON-RPC errors so the client
 * never waits for an answer that cannot come.
 *
 * Security (architecture.md, design decision 22): the relay is a child process of the client talking over pipes. It
 * never listens on a port, and the target host is fixed to IPv4 loopback; only the port is configurable. Requests
 * carry no Origin header and a non-browser User-Agent, so Zotero and the plugin treat them like any local client.
 * A dedicated agent keeps proxy settings from the environment out of the path.
 */
import http from "node:http";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { DEFAULT_ZOTERO_PORT, ENDPOINT_PATH, LOOPBACK_HOST, endpointUrl } from "../../../shared/types/bridge.js";

export const RELAY_NAME = "zotero-reading-bridge-relay";
/** JSON-RPC "server error" code used for answers the relay makes up when Zotero cannot answer. */
export const RELAY_ERROR_CODE = -32000;
/** Generous: tools/call may wait on Zotero's main thread; the client applies its own, shorter timeouts. */
export const DEFAULT_TIMEOUT_MS = 300_000;
/** Responses are whole JSON documents held in memory; anything this large is not a bridge response. */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export interface RelayOptions {
  port: number;
}

export class UsageError extends Error {
  override name = "UsageError";
}

function parsePort(value: string | undefined): number {
  // MCPB substitutes number fields as text; tolerate a "23119.0" spelling but nothing else.
  if (value === undefined || !/^\d+(?:\.0+)?$/.test(value)) throw new UsageError(`--port needs an integer, got ${JSON.stringify(value ?? "")}`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`--port must be 1-65535, got ${value}`);
  return port;
}

/**
 * Command line: `[--port <1-65535>] [--host 127.0.0.1]`. `--host` exists only to fail loudly: any value other than
 * 127.0.0.1 (including localhost, ::1 or 0.0.0.0) is rejected, because the bridge has no authentication.
 */
export function parseRelayArgs(argv: readonly string[]): RelayOptions {
  let port = DEFAULT_ZOTERO_PORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = (): string | undefined => (eq === -1 ? argv[++i] : arg.slice(eq + 1));
    if (name === "--port") {
      port = parsePort(value());
    } else if (name === "--host") {
      const host = value();
      if (host !== LOOPBACK_HOST) throw new UsageError(`--host must be ${LOOPBACK_HOST} (got ${JSON.stringify(host ?? "")}); the bridge is loopback-only`);
    } else {
      throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  return { port };
}

type JsonRpcId = string | number | null;

/** What the relay needs to know about one inbound line: request ids to answer if Zotero cannot, and method names to log. */
interface MessageInfo {
  requestIds: JsonRpcId[];
  methods: string[];
  initializeIds: JsonRpcId[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null;
}

export function describeMessage(line: string): MessageInfo {
  const info: MessageInfo = { requestIds: [], methods: [], initializeIds: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return info; // Forwarded anyway: the plugin answers malformed JSON with a JSON-RPC parse error.
  }
  for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!isRecord(message) || typeof message["method"] !== "string") continue;
    info.methods.push(message["method"]);
    if (!("id" in message) || !isId(message["id"])) continue;
    info.requestIds.push(message["id"]);
    if (message["method"] === "initialize") info.initializeIds.push(message["id"]);
  }
  return info;
}

export interface HttpResult {
  status: number;
  body: Buffer;
}

export interface PostRequest {
  port: number;
  body: Buffer;
  headers: Readonly<Record<string, string>>;
  timeoutMs: number;
}

/** No keep-alive (Zotero closes every connection) and no proxy: the global agent may pick one up from the environment. */
const agent = new http.Agent({ keepAlive: false });

export function postToBridge(request: PostRequest): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: LOOPBACK_HOST,
        port: request.port,
        path: ENDPOINT_PATH,
        method: "POST",
        agent,
        headers: { ...request.headers, "Content-Length": String(request.body.length) },
        timeout: request.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error(`response larger than ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no response within ${request.timeoutMs} ms`)));
    req.on("error", reject);
    req.end(request.body);
  });
}

export interface RelayIo {
  input: Readable;
  output: Writable;
  /** Diagnostics (stderr in production). Gets method names and statuses only, never parameters or results. */
  log?: (line: string) => void;
  /** Version reported in the User-Agent. */
  version: string;
  timeoutMs?: number;
  /** Replaceable for tests. */
  post?: (request: PostRequest) => Promise<HttpResult>;
}

function errorResponse(id: JsonRpcId, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: RELAY_ERROR_CODE, message } });
}

function errorText(error: unknown): string {
  if (isRecord(error) && typeof error["code"] === "string") return error["code"];
  return error instanceof Error ? error.message : String(error);
}

/** The JSON response re-serialized on one line, or null when the body is not a JSON object or array. */
function jsonLine(body: Buffer): { line: string; value: unknown } | null {
  if (body.length === 0) return null;
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    if (typeof value !== "object" || value === null) return null;
    return { line: JSON.stringify(value), value };
  } catch {
    return null;
  }
}

function negotiatedVersion(value: unknown, initializeIds: readonly JsonRpcId[]): string | null {
  for (const message of Array.isArray(value) ? value : [value]) {
    if (!isRecord(message) || !initializeIds.includes(message["id"] as JsonRpcId)) continue;
    const result = message["result"];
    if (isRecord(result) && typeof result["protocolVersion"] === "string") return result["protocolVersion"];
  }
  return null;
}

/**
 * Relay until `input` ends and every forwarded message has been answered. Lines are forwarded as they arrive and
 * answered as Zotero responds (requests are independent; JSON-RPC ids pair them up), so a slow tools/call never
 * holds back a ping or a cancellation.
 */
export function runRelay(options: RelayOptions, io: RelayIo): Promise<void> {
  const url = endpointUrl(options.port, ENDPOINT_PATH);
  const post = io.post ?? postToBridge;
  const log = io.log ?? (() => {});
  const timeoutMs = io.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let protocolVersion: string | null = null;
  let outputOpen = true;
  const pending = new Set<Promise<void>>();

  io.output.on("error", () => {
    outputOpen = false; // The client went away; nothing left to answer.
  });
  const write = (line: string): void => {
    if (outputOpen) io.output.write(`${line}\n`);
  };

  const unreachable = (info: MessageInfo, reason: string): void => {
    for (const id of info.requestIds) write(errorResponse(id, reason));
  };

  async function forward(line: string): Promise<void> {
    const info = describeMessage(line);
    const label = info.methods.join(",") || "message";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": `${RELAY_NAME}/${io.version}`,
    };
    if (protocolVersion !== null && info.initializeIds.length === 0) headers["MCP-Protocol-Version"] = protocolVersion;
    let result: HttpResult;
    try {
      result = await post({ port: options.port, body: Buffer.from(line, "utf8"), headers, timeoutMs });
    } catch (error) {
      const reason = errorText(error);
      log(`${label} -> transport error ${reason}`);
      unreachable(
        info,
        `Cannot reach the Zotero Reading Bridge at ${url} (${reason}). Start Zotero with the Zotero Reading Bridge plugin enabled, then retry.`,
      );
      return;
    }
    log(`${label} -> ${result.status}`);
    const json = jsonLine(result.body);
    if (json) {
      const version = negotiatedVersion(json.value, info.initializeIds);
      if (version !== null) protocolVersion = version;
      write(json.line);
      return;
    }
    if (result.status === 202 || (result.status >= 200 && result.status < 300 && result.body.length === 0)) return;
    const hint =
      result.status === 404
        ? "The endpoint is not registered: enable the Zotero Reading Bridge plugin in Zotero (Tools > Plugins)."
        : "The response was not JSON-RPC; check that this port belongs to Zotero.";
    unreachable(info, `The Zotero Reading Bridge at ${url} answered HTTP ${result.status}. ${hint}`);
  }

  return new Promise((resolve) => {
    const lines = readline.createInterface({ input: io.input, crlfDelay: Infinity, terminal: false });
    lines.on("line", (raw) => {
      const line = raw.trim();
      if (!line) return;
      const task = forward(line).finally(() => pending.delete(task));
      pending.add(task);
    });
    lines.on("close", () => {
      void Promise.allSettled([...pending]).then(() => resolve());
    });
  });
}
