/**
 * handleMcpHttp driven directly (no sockets): every branch of the request algorithm.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { SUPPORTED_PROTOCOL_VERSIONS } from "../../shared/types/mcp.js";
import { TOOL_NAMES, type ToolName } from "../../shared/types/tool-names.js";
import {
  handleMcpHttp,
  INSTRUCTIONS_MAX_CHARS,
  type BridgeHttpRequest,
  type BridgeHttpResponse,
  type McpContext,
  type McpDiagnosticEvent,
} from "../../packages/zotero/src/server/mcp.js";
import { json, text, ToolError, type ToolHandler, type ToolOutput } from "../../packages/zotero/src/tools/types.js";
import { fakeRegistry } from "../fixtures/fake-registry.js";

const PORT = 23119;

interface CallOptions {
  method?: string;
  headers?: Record<string, string | undefined>;
  /** Omit or pass undefined for "no usable body". */
  body?: unknown;
  contentType?: string | null;
  path?: string;
  overrides?: Partial<Record<ToolName, ToolHandler>>;
  instructions?: string;
  onEvent?: (event: McpDiagnosticEvent) => void;
}

interface Result {
  response: BridgeHttpResponse;
  json: any;
  events: McpDiagnosticEvent[];
}

async function call(options: CallOptions): Promise<Result> {
  const events: McpDiagnosticEvent[] = [];
  const ctx: McpContext = {
    registry: fakeRegistry(options.overrides),
    serverVersion: "9.9.9",
    instructions: options.instructions ?? "Use search_items first.",
    port: PORT,
    onEvent:
      options.onEvent ??
      ((event) => {
        events.push(event);
      }),
  };
  const req: BridgeHttpRequest = {
    method: options.method ?? "POST",
    path: options.path ?? "/bridge/mcp",
    headers: { host: `127.0.0.1:${PORT}`, accept: "application/json, text/event-stream", ...options.headers },
    body: "body" in options ? options.body : undefined,
    contentType: options.contentType === undefined ? "application/json" : options.contentType,
  };
  const response = await handleMcpHttp(req, ctx);
  assert.ok(response.status < 500, `never 5xx (got ${response.status})`);
  assertWellFormed(response);
  return { response, json: response.body ? JSON.parse(response.body) : undefined, events };
}

function assertWellFormed(response: BridgeHttpResponse): void {
  const names = Object.keys(response.headers).map((name) => name.toLowerCase());
  assert.ok(!names.includes("mcp-session-id"), "never sends a session id");
  assert.ok(!names.some((name) => name.startsWith("access-control-")), "never sends CORS headers");
  assert.equal(response.headers["Connection"], "close");
  if (response.body) {
    assert.match(response.body, /^[\x00-\x7f]*$/, "body is ASCII-escaped");
    assert.equal(response.headers["Content-Type"], "application/json");
    assert.equal(response.headers["Content-Length"], String(Buffer.byteLength(response.body, "utf8")));
  } else {
    assert.equal(response.headers["Content-Length"], undefined);
  }
}

function rpc(method: string, params?: unknown, id: unknown = 1): Record<string, unknown> {
  const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
  if (params !== undefined) message["params"] = params;
  return message;
}

const V = { "mcp-protocol-version": "2025-11-25" };

async function callTool(name: string, args?: unknown, options: Omit<CallOptions, "body"> = {}) {
  const params: Record<string, unknown> = { name };
  if (args !== undefined) params["arguments"] = args;
  const result = await call({ ...options, headers: { ...V, ...options.headers }, body: rpc("tools/call", params, 7) });
  return { ...result, tool: result.json.result as { content: Array<{ type: string; text: string }>; isError?: boolean } };
}

function toolPayload(result: { content: Array<{ type: string; text: string }> }): any {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]?.type, "text");
  return JSON.parse(result.content[0]!.text);
}

describe("initialize", () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    it(`echoes supported version ${version}`, async () => {
      const { response, json: body } = await call({
        body: rpc("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } }, 0),
      });
      assert.equal(response.status, 200);
      assert.equal(body.id, 0);
      assert.equal(body.result.protocolVersion, version);
    });
  }

  it("answers 2025-11-25 for unknown or missing versions instead of failing", async () => {
    for (const params of [{ protocolVersion: "2026-07-28" }, { protocolVersion: "1999-01-01" }, {}, undefined, null]) {
      const { json: body } = await call({ body: rpc("initialize", params) });
      assert.equal(body.result.protocolVersion, "2025-11-25", JSON.stringify(params));
    }
  });

  it("declares only tools and identifies the server", async () => {
    const { json: body } = await call({ body: rpc("initialize", { protocolVersion: "2025-11-25" }) });
    assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
    assert.deepEqual(body.result.serverInfo, { name: "zotero-ai-bridge", title: "Zotero AI Bridge", version: "9.9.9" });
    assert.equal(body.result.instructions, "Use search_items first.");
  });

  it("ignores the MCP-Protocol-Version header, even an unsupported one", async () => {
    const { response, json: body } = await call({
      headers: { "mcp-protocol-version": "2026-07-28" },
      body: rpc("initialize", { protocolVersion: "2025-06-18" }),
    });
    assert.equal(response.status, 200);
    assert.equal(body.result.protocolVersion, "2025-06-18");
  });

  it("caps instructions and omits empty ones", async () => {
    const long = await call({ instructions: "x".repeat(10_000), body: rpc("initialize", {}) });
    assert.equal(long.json.result.instructions.length, INSTRUCTIONS_MAX_CHARS);
    const none = await call({ instructions: "", body: rpc("initialize", {}) });
    assert.equal("instructions" in none.json.result, false);
  });

  it("ignores a client-sent Mcp-Session-Id", async () => {
    const { response } = await call({ headers: { "mcp-session-id": "stale" }, body: rpc("initialize", {}) });
    assert.equal(response.status, 200);
  });
});

describe("2026-07-28 probe and protocol header", () => {
  it("answers server/discover with 400 + -32601 echoing a string id", async () => {
    const { response, json: body } = await call({
      headers: { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" },
      body: rpc("server/discover", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }, "server-discover-probe-1"),
    });
    assert.equal(response.status, 400);
    assert.equal(body.id, "server-discover-probe-1");
    assert.equal(body.error.code, -32601);
    assert.match(body.error.message, /initialize/);
  });

  it("echoes numeric ids including 0, and answers the probe even without the header", async () => {
    const zero = await call({ headers: { "mcp-protocol-version": "2026-07-28" }, body: rpc("server/discover", {}, 0) });
    assert.equal(zero.json.id, 0);
    const headerless = await call({ body: rpc("server/discover", {}, 5) });
    assert.deepEqual([headerless.response.status, headerless.json.id, headerless.json.error.code], [400, 5, -32601]);
  });

  it("rejects other requests with an unsupported header: 400 + -32600 echoing the id", async () => {
    for (const header of ["2026-07-28", "2099-01-01", "", "garbage"]) {
      const { response, json: body } = await call({ headers: { "mcp-protocol-version": header }, body: rpc("tools/list", {}, 7) });
      assert.equal(response.status, 400, header);
      assert.equal(body.id, 7);
      assert.equal(body.error.code, -32600);
      assert.match(body.error.message, /Unsupported protocol version/);
    }
  });

  it("accepts every supported header and a missing header (2025-03-26)", async () => {
    for (const header of [...SUPPORTED_PROTOCOL_VERSIONS, undefined]) {
      const { response } = await call({ headers: { "mcp-protocol-version": header }, body: rpc("tools/list") });
      assert.equal(response.status, 200, String(header));
    }
  });

  it("passes the effective version and endpoint path to handlers", async () => {
    const viaHeader = await callTool("get_status", {}, { headers: { "mcp-protocol-version": "2025-06-18" }, path: "/codex/mcp" });
    assert.deepEqual(toolPayload(viaHeader.tool).ctx, { protocolVersion: "2025-06-18", endpointPath: "/codex/mcp" });
    const headerless = await call({ body: rpc("tools/call", { name: "get_status" }) });
    assert.equal(toolPayload(headerless.json.result).ctx.protocolVersion, "2025-03-26");
  });
});

describe("HTTP transport rules", () => {
  for (const method of ["GET", "DELETE", "PUT", "PATCH"]) {
    it(`${method} gets 405 with Allow: POST`, async () => {
      const { response, json: body } = await call({ method, body: undefined, contentType: null });
      assert.equal(response.status, 405);
      assert.equal(response.headers["Allow"], "POST");
      assert.equal(body.id, null);
    });
  }

  it("rejects Origin (any value) and bad Host with 403 before anything else", async () => {
    for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }, { host: "evil.example:23119" }, { host: "127.0.0.1:1" }]) {
      const { response, json: body } = await call({ method: "GET", headers, body: rpc("ping") });
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(body.id, null);
      assert.equal(body.error.code, -32000);
    }
  });

  it("is lenient about Accept but rejects ranges that exclude JSON", async () => {
    for (const accept of [undefined, "", "application/json", "text/event-stream, application/json", "*/*", "application/*", "APPLICATION/JSON;q=0.9"]) {
      const { response } = await call({ headers: { accept }, body: rpc("ping") });
      assert.equal(response.status, 200, String(accept));
    }
    for (const accept of ["text/event-stream", "text/html, text/plain"]) {
      const { response } = await call({ headers: { accept }, body: rpc("ping") });
      assert.equal(response.status, 406, accept);
    }
  });

  it("honours q=0 (RFC 9110: not acceptable), with the most specific range deciding", async () => {
    for (const accept of [
      "application/json;q=0, text/event-stream",
      "application/json; q=0.000",
      "*/*, application/json;q=0",
      "application/*;q=0, */*",
      "*/*;q=0",
    ]) {
      const { response, json: body } = await call({ headers: { accept }, body: rpc("ping") });
      assert.equal(response.status, 406, accept);
      assert.equal(body.error.code, -32000);
    }
    for (const accept of ["*/*;q=0, application/json", "application/*;q=0, application/json;q=0.5", "application/json;q=0.001", "application/json;q=0, application/json;q=1"]) {
      const { response } = await call({ headers: { accept }, body: rpc("ping") });
      assert.equal(response.status, 200, accept);
    }
  });

  it("requires a JSON content type", async () => {
    for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const { response } = await call({ contentType, body: undefined });
      assert.equal(response.status, 415, String(contentType));
    }
    for (const contentType of ["application/json; charset=utf-8", "Application/JSON"]) {
      const { response } = await call({ contentType, body: rpc("ping") });
      assert.equal(response.status, 200, contentType);
    }
  });

  it("answers 400 -32700 when a JSON request arrived without a usable body", async () => {
    const { response, json: body } = await call({ contentType: "Application/JSON", body: undefined });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, -32700);
  });

  it("answers 400 -32600 for malformed messages", async () => {
    const cases: Array<[unknown, unknown]> = [
      [null, null],
      [42, null],
      ["ping", null],
      [{ jsonrpc: "1.0", id: 3, method: "ping" }, 3],
      [{ id: 3, method: "ping" }, 3],
      [{ jsonrpc: "2.0", id: 3, method: 5 }, 3],
      [{ jsonrpc: "2.0", id: null, method: "ping" }, null],
      [{ jsonrpc: "2.0", id: { a: 1 }, method: "ping" }, null],
      [{ jsonrpc: "2.0", id: 3 }, 3],
    ];
    for (const [message, id] of cases) {
      const { response, json: body } = await call({ body: message });
      assert.equal(response.status, 400, JSON.stringify(message));
      assert.equal(body.error.code, -32600, JSON.stringify(message));
      assert.equal(body.id, id, JSON.stringify(message));
    }
  });

  it("answers notifications and client responses with 202 and no body", async () => {
    for (const message of [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2, reason: "timeout" } },
      { jsonrpc: "2.0", method: "unknown/notification" },
      { jsonrpc: "2.0", id: 9, result: {} },
      { jsonrpc: "2.0", id: 9, error: { code: -1, message: "x" } },
    ]) {
      const { response } = await call({ headers: V, body: message });
      assert.equal(response.status, 202, JSON.stringify(message));
      assert.equal(response.body, "");
    }
  });
});

describe("batches", () => {
  const batch = [rpc("tools/list", {}, 10), { jsonrpc: "2.0", method: "notifications/progress" }, rpc("ping", undefined, 11)];

  it("are processed for 2025-03-26 (no header or explicit header)", async () => {
    for (const headers of [{}, { "mcp-protocol-version": "2025-03-26" }]) {
      const { response, json: body } = await call({ headers, body: batch });
      assert.equal(response.status, 200);
      assert.deepEqual(
        body.map((entry: { id: unknown }) => entry.id),
        [10, 11],
      );
      assert.equal(body[0].result.tools.length, TOOL_NAMES.length);
      assert.deepEqual(body[1].result, {});
    }
  });

  it("are rejected for 2025-06-18 and 2025-11-25", async () => {
    for (const version of ["2025-06-18", "2025-11-25"]) {
      const { response, json: body } = await call({ headers: { "mcp-protocol-version": version }, body: batch });
      assert.equal(response.status, 400);
      assert.deepEqual([body.id, body.error.code], [null, -32600]);
      assert.match(body.error.message, /batching/);
    }
    const unsupported = await call({ headers: { "mcp-protocol-version": "2026-07-28" }, body: batch });
    assert.equal(unsupported.response.status, 400);
  });

  it("reject empty batches, oversized batches and initialize", async () => {
    for (const body of [[], Array.from({ length: 33 }, (_, i) => rpc("ping", undefined, i)), [rpc("initialize", {}), rpc("ping")]]) {
      const { response, json: reply } = await call({ body });
      assert.equal(response.status, 400);
      assert.equal(reply.error.code, -32600);
    }
  });

  it("answer 202 when only notifications and responses are batched", async () => {
    const { response } = await call({ body: [{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 1, result: {} }] });
    assert.equal(response.status, 202);
  });

  it("report invalid members individually", async () => {
    const { response, json: body } = await call({ body: [42, rpc("nope", undefined, 2), rpc("ping", undefined, 3)] });
    assert.equal(response.status, 200);
    assert.deepEqual(
      body.map((entry: { id: unknown; error?: { code: number } }) => [entry.id, entry.error?.code ?? null]),
      [
        [null, -32600],
        [2, -32601],
        [3, null],
      ],
    );
  });
});

describe("JSON-RPC methods", () => {
  it("ping returns an empty result", async () => {
    const { json: body } = await call({ headers: V, body: rpc("ping", undefined, "p1") });
    assert.deepEqual(body, { jsonrpc: "2.0", id: "p1", result: {} });
  });

  it("tools/list returns every contract tool, ignores cursors and omits nextCursor", async () => {
    const { json: body } = await call({ headers: V, body: rpc("tools/list", { cursor: "anything" }) });
    assert.deepEqual(
      body.result.tools.map((tool: { name: string }) => tool.name),
      [...TOOL_NAMES],
    );
    assert.equal("nextCursor" in body.result, false);
    for (const tool of body.result.tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal("outputSchema" in tool, false);
    }
  });

  it("works before initialize (stateless)", async () => {
    const { response } = await callTool("get_status", {});
    assert.equal(response.status, 200);
  });

  it("rejects non-object params with -32602 instead of ignoring them (null and missing params are accepted)", async () => {
    for (const method of ["initialize", "ping", "tools/list", "tools/call"]) {
      for (const params of ["2025-06-18", 5, true, [], [1]]) {
        const { response, json: body } = await call({ headers: V, body: rpc(method, params, 9) });
        assert.equal(response.status, 200, `${method} ${JSON.stringify(params)}`);
        assert.deepEqual([body.id, body.error?.code], [9, -32602], `${method} ${JSON.stringify(params)}`);
      }
    }
    for (const method of ["initialize", "ping", "tools/list"]) {
      for (const params of [undefined, null, {}]) {
        const { json: body } = await call({ headers: V, body: rpc(method, params, 9) });
        assert.ok(body.result, `${method} ${JSON.stringify(params)}`);
      }
    }
    // Unknown methods stay -32601 whatever their params.
    const unknown = await call({ headers: V, body: rpc("resources/list", "x", 9) });
    assert.equal(unknown.json.error.code, -32601);
  });

  it("unknown methods get -32601 with HTTP 200", async () => {
    for (const method of ["resources/list", "prompts/list", "logging/setLevel", "tasks/get", "x".repeat(500)]) {
      const { response, json: body } = await call({ headers: V, body: rpc(method, {}, 4) });
      assert.equal(response.status, 200);
      assert.deepEqual([body.id, body.error.code], [4, -32601]);
      assert.ok(body.error.message.length < 150, "client-supplied method name is clipped");
    }
  });
});

describe("tools/call", () => {
  it("applies schema defaults and returns compact JSON text", async () => {
    const { response, tool } = await callTool("search_items", { query: "transformer" });
    assert.equal(response.status, 200);
    assert.equal(tool.isError, undefined);
    const payload = toolPayload(tool);
    assert.deepEqual(payload.args, {
      query: "transformer",
      mode: "titleCreatorYear",
      includeChildItems: false,
      sort: "dateModified",
      direction: "desc",
      limit: 50,
    });
    assert.ok(!tool.content[0]!.text.includes("\n"), "compact JSON");
  });

  it("treats omitted arguments as {}", async () => {
    const { tool } = await callTool("get_current_context");
    assert.deepEqual(toolPayload(tool).args, { maxTextLength: 4000 });
  });

  it("returns text outputs verbatim", async () => {
    const hookJson = '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"选中的文本"}}';
    const { response, tool } = await callTool(
      "capture_prompt_context",
      { client: "codex", session_id: "s", turn_id: "t" },
      { overrides: { capture_prompt_context: async () => text(hookJson) } },
    );
    assert.deepEqual(tool.content, [{ type: "text", text: hookJson }]);
    assert.ok(response.body.includes("\\u9009\\u4e2d"), "envelope escapes non-ASCII");
  });

  it("rejects unknown tools and malformed params with -32602", async () => {
    const cases: unknown[] = [
      { name: "delete_everything" },
      { name: "constructor" },
      {},
      { name: 5 },
      { name: "get_status", arguments: [] },
      { name: "get_status", arguments: null },
      { name: "get_status", arguments: "x" },
    ];
    for (const params of cases) {
      const { response, json: body } = await call({ headers: V, body: rpc("tools/call", params, 3) });
      assert.equal(response.status, 200, JSON.stringify(params));
      assert.deepEqual([body.id, body.error?.code], [3, -32602], JSON.stringify(params));
    }
    const noParams = await call({ headers: V, body: rpc("tools/call", undefined, 3) });
    assert.equal(noParams.json.error.code, -32602);
  });

  it("reports argument validation failures as isError tool results (SEP-1303)", async () => {
    let called = false;
    const { response, tool } = await callTool(
      "search_items",
      { query: "", limit: 1000, bogus: true },
      {
        overrides: {
          search_items: async () => {
            called = true;
            return json({});
          },
        },
      },
    );
    assert.equal(response.status, 200);
    assert.equal(tool.isError, true);
    assert.equal(called, false, "handler not called");
    const payload = toolPayload(tool);
    assert.equal(payload.error.code, "INVALID_ARGUMENT");
    assert.match(payload.error.message, /^Invalid arguments: query must be at least 1 characters/);
    assert.match(payload.error.message, /limit must be <= 200 \(got 1000\)/);
    assert.match(payload.error.message, /bogus is not an allowed property/);
    assert.equal(payload.error.details.issues.length, 3);
  });

  it("caps the number of reported issues", async () => {
    const args: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) args[`k${i}`] = i;
    const { tool } = await callTool("get_status", args);
    assert.equal(toolPayload(tool).error.details.issues.length, 10);
  });

  it("maps ToolError to an isError result with its code and details", async () => {
    const { tool } = await callTool(
      "get_items",
      { keys: ["ABCD2345"] },
      {
        overrides: {
          get_items: async () => {
            throw new ToolError("NOT_FOUND", "Item ABCD2345 not found in library 1", { key: "ABCD2345" });
          },
        },
      },
    );
    assert.equal(tool.isError, true);
    assert.deepEqual(toolPayload(tool), {
      error: { code: "NOT_FOUND", message: "Item ABCD2345 not found in library 1", details: { key: "ABCD2345" } },
    });
  });

  it("hides unexpected exception messages and never answers 5xx", async () => {
    const secret = "secret note text";
    const throwing: Array<[string, ToolHandler]> = [
      ["TypeError", async () => { throw new TypeError(secret); }],
      ["string", async () => { throw secret; }],
      ["sync", () => { throw new RangeError(secret); }],
      ["bad output", async () => ({ kind: "html", html: secret }) as unknown as ToolOutput],
      ["unserializable", async () => json({ big: BigInt(1) })],
      ["cyclic", async () => { const a: Record<string, unknown> = {}; a["a"] = a; return json(a); }],
    ];
    for (const [label, handler] of throwing) {
      const { response, tool, events } = await callTool("get_status", {}, { overrides: { get_status: handler } });
      assert.equal(response.status, 200, label);
      assert.equal(tool.isError, true, label);
      const payload = toolPayload(tool);
      assert.equal(payload.error.code, "INTERNAL", label);
      assert.ok(!response.body.includes(secret), `${label}: exception message not leaked`);
      assert.equal(events[0]?.outcome, "tool-error", label);
      assert.ok(events[0]?.errorType, label);
    }
  });

  it("reports only the type name of an exception from another realm (as thrown by Zotero code)", async () => {
    const secret = "secret annotation text";
    const cases: Array<[unknown, string]> = [
      [vm.runInNewContext(`new TypeError(${JSON.stringify(secret)})`), "TypeError"],
      [{ name: `${secret} <b>`, message: secret }, "object"],
      [null, "object"],
    ];
    for (const [thrown, expected] of cases) {
      const { response, tool, events } = await callTool("get_status", {}, {
        overrides: { get_status: async () => { throw thrown; } },
      });
      assert.equal(events[0]?.errorType, expected);
      assert.equal(toolPayload(tool).error.message, `Internal error while running get_status (${expected})`);
      assert.ok(!response.body.includes("secret"), "exception content not leaked");
    }
  });

  it("serializes undefined JSON data as null", async () => {
    const { tool } = await callTool("get_status", {}, { overrides: { get_status: async () => json(undefined) } });
    assert.equal(tool.content[0]?.text, "null");
  });

  it("keeps Chinese and astral text intact through the escaped envelope", async () => {
    const title = "注意力机制 😀   é";
    const { response, tool } = await callTool("get_status", {}, { overrides: { get_status: async () => json({ title }) } });
    assert.equal(toolPayload(tool).title, title);
    assert.equal(Number(response.headers["Content-Length"]), response.body.length);
  });
});

describe("diagnostic events", () => {
  it("emits one content-free event per request", async () => {
    const { events } = await callTool("search_items", { query: "private query text" });
    assert.equal(events.length, 1);
    const [event] = events;
    assert.deepEqual(
      { ...event, ms: 0 },
      { httpMethod: "POST", rpcMethod: "tools/call", tool: "search_items", status: 200, bytes: event!.bytes, ms: 0, outcome: "ok" },
    );
    assert.ok(!JSON.stringify(events).includes("private query text"));
  });

  it("classifies outcomes", async () => {
    const cases: Array<[CallOptions, McpDiagnosticEvent["outcome"]]> = [
      [{ headers: V, body: rpc("nope") }, "rpc-error"],
      [{ headers: V, body: rpc("tools/call", { name: "get_status", arguments: { x: 1 } }) }, "tool-error"],
      [{ method: "GET", body: undefined }, "rejected"],
      [{ headers: V, body: { jsonrpc: "2.0", method: "notifications/initialized" } }, "ok"],
      [{ body: [rpc("ping", undefined, 1), rpc("nope", undefined, 2)] }, "rpc-error"],
    ];
    for (const [options, outcome] of cases) {
      const { events } = await call(options);
      assert.equal(events[0]?.outcome, outcome, JSON.stringify(options.body));
    }
  });

  it("does not report unknown tool names and clips method names", async () => {
    const unknown = await call({ headers: V, body: rpc("tools/call", { name: "x".repeat(300) }) });
    assert.equal(unknown.events[0]?.tool, null);
    const long = await call({ headers: V, body: rpc("m\u0000".repeat(100)) });
    assert.ok((long.events[0]?.rpcMethod?.length ?? 0) <= 64);
    assert.ok(!long.events[0]?.rpcMethod?.includes("\u0000"));
  });

  it("survives a throwing event listener", async () => {
    const { response } = await call({
      headers: V,
      body: rpc("ping"),
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    assert.equal(response.status, 200);
  });
});

describe("robustness", () => {
  it("never answers 5xx for odd inputs", async () => {
    const bodies: unknown[] = [
      true,
      [],
      [[]],
      [null],
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_items", arguments: { keys: "ABCD2345" } } },
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 5 } },
      { jsonrpc: "2.0", id: 1.5, method: "ping" },
      { jsonrpc: "2.0", id: "", method: "ping" },
      JSON.parse('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status","arguments":{"__proto__":{"x":1}}}}'),
    ];
    for (const body of bodies) {
      for (const headers of [{}, V]) await call({ headers, body });
    }
  });

  it("turns an exception escaping the router into 200 + -32603", async () => {
    const registry = fakeRegistry();
    const broken = { ...registry, definitions: () => { throw new Error("boom"); } };
    const response = await handleMcpHttp(
      {
        method: "POST",
        path: "/bridge/mcp",
        headers: { host: "127.0.0.1:23119" },
        body: rpc("tools/list", {}, "x"),
        contentType: "application/json",
      },
      { registry: broken, serverVersion: "1", instructions: "", port: PORT },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { jsonrpc: "2.0", id: "x", error: { code: -32603, message: "Internal error" } });
  });
});
