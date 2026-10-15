/**
 * Minimal MCP client for the live cases: JSON-RPC over the bridge's stateless Streamable HTTP endpoint,
 * built on the raw HTTP client so every response header and status stays observable.
 */
import { ENDPOINT_PATH } from "../../../shared/types/bridge.js";
import { LATEST_PROTOCOL_VERSION, type CallToolResult, type ToolErrorPayload } from "../../../shared/types/index.js";
import { postJson, type JsonPostOptions, type RawResponse, type RawResult } from "./http.js";

export interface RpcOutcome {
  http: RawResponse;
  message: any;
  ms: number;
}

export interface ToolCall {
  result: CallToolResult;
  /** Text of the single content item. */
  text: string;
  /** Parsed JSON of `text`, or undefined when it is not JSON. */
  json: any;
  isError: boolean;
  ms: number;
}

export class McpClient {
  private nextId = 1;

  constructor(
    readonly port: number,
    readonly path: string = ENDPOINT_PATH,
    readonly protocolVersion: string = LATEST_PROTOCOL_VERSION,
  ) {}

  /** POST a JSON-RPC payload; adds MCP-Protocol-Version unless the caller overrides it. */
  post(payload: unknown, options: JsonPostOptions & { versionHeader?: string | null } = {}): Promise<RawResult> {
    const version = options.versionHeader === undefined ? this.protocolVersion : options.versionHeader;
    const extraHeaders: Array<[string, string]> = [...(options.extraHeaders ?? [])];
    if (version !== null) extraHeaders.push(["MCP-Protocol-Version", version]);
    return postJson(this.port, this.path, payload, { ...options, extraHeaders });
  }

  async rpc(method: string, params?: Record<string, unknown>, options: { versionHeader?: string | null } = {}): Promise<RpcOutcome> {
    const id = this.nextId++;
    const result = await this.post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, options);
    if (!result.response) {
      throw new Error(`${method}: no HTTP response from ${this.path} (${result.dropped ? "connection dropped" : result.error})`);
    }
    const http = result.response;
    if (http.status !== 200) throw new Error(`${method}: HTTP ${http.status} ${http.body.slice(0, 300)}`);
    let message: any;
    try {
      message = JSON.parse(http.body);
    } catch {
      throw new Error(`${method}: response is not JSON: ${http.body.slice(0, 300)}`);
    }
    if (message?.id !== id) throw new Error(`${method}: response id ${JSON.stringify(message?.id)} != request id ${id}`);
    return { http, message, ms: result.ms };
  }

  /** initialize (no version header, as clients do) followed by notifications/initialized. */
  async initialize(clientName = "zab-harness"): Promise<RpcOutcome> {
    const init = await this.rpc(
      "initialize",
      { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: clientName, version: "1.0.0" } },
      { versionHeader: null },
    );
    if (init.message.error) throw new Error(`initialize failed: ${JSON.stringify(init.message.error)}`);
    const notified = await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    if (notified.response?.status !== 202) {
      throw new Error(`notifications/initialized: expected 202, got ${notified.response?.status ?? "no response"}`);
    }
    return init;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCall> {
    const outcome = await this.rpc("tools/call", { name, arguments: args });
    if (outcome.message.error) {
      throw new Error(`tools/call ${name}: JSON-RPC error ${JSON.stringify(outcome.message.error)}`);
    }
    const result = outcome.message.result as CallToolResult;
    const content = Array.isArray(result?.content) ? result.content : [];
    if (content.length !== 1 || content[0]?.type !== "text") {
      throw new Error(`tools/call ${name}: expected exactly one text content item, got ${JSON.stringify(content).slice(0, 300)}`);
    }
    const text = content[0].text;
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { result, text, json, isError: result.isError === true, ms: outcome.ms };
  }

  /** Call a tool that must succeed; returns its parsed JSON payload. */
  async tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const call = await this.callTool(name, args);
    if (call.isError) throw new Error(`${name} returned isError: ${call.text.slice(0, 500)}`);
    if (call.json === undefined) throw new Error(`${name} returned non-JSON text: ${call.text.slice(0, 200)}`);
    return call.json as T;
  }

  /** Call a tool that must fail with a tool-execution error; returns the error payload. */
  async toolError(name: string, args: Record<string, unknown>): Promise<ToolErrorPayload["error"]> {
    const call = await this.callTool(name, args);
    if (!call.isError) throw new Error(`${name} unexpectedly succeeded: ${call.text.slice(0, 300)}`);
    const payload = call.json as ToolErrorPayload | undefined;
    if (!payload?.error?.code) throw new Error(`${name} error payload malformed: ${call.text.slice(0, 300)}`);
    return payload.error;
  }
}
