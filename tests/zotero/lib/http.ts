/**
 * Raw HTTP/1.x client over a TCP socket. The access cases need exact control that fetch/undici do not
 * give: forged Host headers, HTTP/1.0 request lines, Origin / browser User-Agent headers, and telling a
 * silently dropped connection (Zotero's browser protection) apart from an HTTP error.
 */
import net from "node:net";
import { LOOPBACK_HOST } from "../../../shared/types/bridge.js";

export interface RawResponse {
  statusLine: string;
  httpVersion: string;
  status: number;
  /** Header names lowercased; repeated headers are joined with ", ". */
  headers: Record<string, string>;
  /** Header names exactly as received, in order (for case and duplicate checks). */
  rawHeaders: Array<[string, string]>;
  body: string;
  bodyBytes: number;
}

export interface RawResult {
  /** True when the server closed the connection without sending a single byte. */
  dropped: boolean;
  response: RawResponse | null;
  error: string | null;
  ms: number;
}

export interface RawRequest {
  port: number;
  method: string;
  path: string;
  /** Sent verbatim and in order. Host/Content-Length are NOT added automatically. */
  headers: Array<[string, string]>;
  body?: string | Buffer;
  httpVersion?: "1.0" | "1.1";
  timeoutMs?: number;
}

function parseResponse(data: Buffer): RawResponse {
  const headerEnd = data.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new Error(`Incomplete HTTP response (${data.length} bytes)`);
  const head = data.subarray(0, headerEnd).toString("latin1").split("\r\n");
  const statusLine = head.shift() ?? "";
  const match = /^HTTP\/(\d\.\d) (\d{3})(?: .*)?$/.exec(statusLine);
  if (!match) throw new Error(`Malformed status line: ${JSON.stringify(statusLine)}`);
  const rawHeaders: Array<[string, string]> = [];
  const headers: Record<string, string> = {};
  for (const line of head) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    rawHeaders.push([name, value]);
    const lower = name.toLowerCase();
    headers[lower] = headers[lower] === undefined ? value : `${headers[lower]}, ${value}`;
  }
  let body = data.subarray(headerEnd + 4);
  const declared = headers["content-length"];
  if (declared !== undefined && /^\d+$/.test(declared)) body = body.subarray(0, Number(declared));
  return {
    statusLine,
    httpVersion: match[1] ?? "",
    status: Number(match[2]),
    headers,
    rawHeaders,
    body: body.toString("utf8"),
    bodyBytes: body.length,
  };
}

/** Send one request and read until the server closes the connection (Zotero never keeps it alive). */
export function rawRequest(request: RawRequest): Promise<RawResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      const data = Buffer.concat(chunks);
      const ms = Date.now() - started;
      if (data.length === 0) {
        resolve({ dropped: error === null, response: null, error, ms });
        return;
      }
      try {
        resolve({ dropped: false, response: parseResponse(data), error: null, ms });
      } catch (parseError) {
        resolve({ dropped: false, response: null, error: String(parseError), ms });
      }
    };
    const socket = net.connect({ host: LOOPBACK_HOST, port: request.port });
    socket.setTimeout(request.timeoutMs ?? 30000, () => finish(`timeout after ${request.timeoutMs ?? 30000} ms`));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => finish(null));
    socket.on("close", () => finish(null));
    socket.on("error", (error) => {
      // A reset after a complete response still counts as a response.
      finish(chunks.length ? null : String(error));
    });
    socket.on("connect", () => {
      const lines = [`${request.method} ${request.path} HTTP/${request.httpVersion ?? "1.1"}`];
      for (const [name, value] of request.headers) lines.push(`${name}: ${value}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`, "latin1");
      if (request.body !== undefined) socket.write(request.body);
    });
  });
}

/** Escape non-ASCII so request bodies are pure ASCII (the byte count is then the string length). */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export interface JsonPostOptions {
  extraHeaders?: Array<[string, string]>;
  /** Override or remove (null) default headers by lowercase name. */
  override?: Record<string, string | null>;
  httpVersion?: "1.0" | "1.1";
  timeoutMs?: number;
}

/** Headers a well-behaved non-browser MCP client sends (no Origin, non-Mozilla User-Agent). */
export function defaultHeaders(port: number, bodyLength: number): Array<[string, string]> {
  return [
    ["Host", `${LOOPBACK_HOST}:${port}`],
    ["User-Agent", "zab-harness/1.0"],
    ["Accept", "application/json, text/event-stream"],
    ["Content-Type", "application/json"],
    ["Content-Length", String(bodyLength)],
    ["Connection", "close"],
  ];
}

export function buildHeaders(port: number, body: string, options: JsonPostOptions = {}): Array<[string, string]> {
  const headers = defaultHeaders(port, Buffer.byteLength(body)).filter(([name]) => options.override?.[name.toLowerCase()] !== null);
  const replaced = headers.map(([name, value]): [string, string] => {
    const override = options.override?.[name.toLowerCase()];
    return [name, typeof override === "string" ? override : value];
  });
  return [...replaced, ...(options.extraHeaders ?? [])];
}

export function postJson(port: number, path: string, payload: unknown, options: JsonPostOptions = {}): Promise<RawResult> {
  const body = typeof payload === "string" ? payload : asciiJson(payload);
  return rawRequest({
    port,
    method: "POST",
    path,
    headers: buildHeaders(port, body, options),
    body,
    httpVersion: options.httpVersion,
    timeoutMs: options.timeoutMs,
  });
}

export function getRequest(port: number, path: string, extraHeaders: Array<[string, string]> = []): Promise<RawResult> {
  return rawRequest({
    port,
    method: "GET",
    path,
    headers: [["Host", `${LOOPBACK_HOST}:${port}`], ["User-Agent", "zab-harness/1.0"], ["Connection", "close"], ...extraHeaders],
  });
}

/** Resolve true once something accepts TCP connections on the port. */
export function portOpen(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: LOOPBACK_HOST, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}
