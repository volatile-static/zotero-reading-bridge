/**
 * MCP transport and JSON-RPC behaviour of the bridge over Zotero's real HTTP server (DESIGN decisions
 * 5-12), observed with a raw socket client so status lines, headers and dropped connections are visible.
 */
import assert from "node:assert/strict";
import { ENDPOINT_PATH, ENDPOINT_PATHS, LOOPBACK_HOST } from "../../../shared/types/bridge.js";
import { JSONRPC_INVALID_PARAMS, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, SUPPORTED_PROTOCOL_VERSIONS } from "../../../shared/types/mcp.js";
import { TOOL_NAMES } from "../../../shared/types/tool-names.js";
import { rawRequest, type RawResponse, type RawResult } from "../lib/http.js";
import type { HarnessContext, TestCase } from "./types.js";

/** Decision 10: lowercase JSON media type, exact Content-Length, ASCII-only body, no session id. */
export function assertJsonResponse(http: RawResponse, what: string): void {
  const contentType = http.rawHeaders.filter(([name]) => name.toLowerCase() === "content-type").map(([, value]) => value);
  assert.deepEqual(contentType, ["application/json"], `${what}: Content-Type ${JSON.stringify(contentType)}`);
  const lengths = http.rawHeaders.filter(([name]) => name.toLowerCase() === "content-length").map(([, value]) => value);
  assert.deepEqual(lengths, [String(http.bodyBytes)], `${what}: Content-Length ${JSON.stringify(lengths)} for ${http.bodyBytes} body bytes`);
  assert.ok(/^[\x00-\x7f]*$/.test(http.body), `${what}: body contains raw non-ASCII characters`);
  assert.equal(http.headers["mcp-session-id"], undefined, `${what}: Mcp-Session-Id must never be sent`);
  assert.equal(http.headers["access-control-allow-origin"], undefined, `${what}: CORS header present`);
}

/** Zotero prints responseCodes[status] verbatim ("undefined" when missing); the bridge adds 202/405/406/415. */
export function assertReasonPhrase(http: RawResponse, phrase: string): void {
  assert.equal(http.statusLine.replace(/^HTTP\/\d\.\d \d{3} ?/, ""), phrase, `status line ${JSON.stringify(http.statusLine)}`);
}

function response(result: RawResult, what: string): RawResponse {
  assert.ok(result.response, `${what}: no HTTP response (${result.dropped ? "connection dropped" : result.error})`);
  assert.ok(result.response.status < 500, `${what}: HTTP ${result.response.status} (never 5xx)`);
  return result.response;
}

function jsonBody(http: RawResponse, what: string): any {
  try {
    return JSON.parse(http.body);
  } catch {
    throw new Error(`${what}: body is not JSON: ${http.body.slice(0, 200)}`);
  }
}

/** A transport-level rejection: the status, a JSON-RPC error with `code`, and the echoed id. */
function assertRpcRejection(result: RawResult, status: number, code: number, id: unknown, what: string): void {
  const http = response(result, what);
  assert.equal(http.status, status, `${what}: HTTP ${http.status} ${http.body.slice(0, 200)}`);
  assertJsonResponse(http, what);
  const message = jsonBody(http, what);
  assert.equal(message?.error?.code, code, `${what}: error ${JSON.stringify(message?.error)}`);
  assert.deepEqual(message.id, id, `${what}: id`);
}

function initializeCase(version: string): TestCase {
  return {
    id: `protocol.initialize-${version}`,
    title: `initialize negotiates ${version} and notifications/initialized is accepted with 202`,
    requires: ["bridge"],
    async run(ctx) {
      const client = ctx.mcp(ENDPOINT_PATH, version);
      const init = await client.initialize(`zab-harness-${version}`);
      assertJsonResponse(init.http, "initialize");
      const result = init.message.result;
      assert.equal(result.protocolVersion, version);
      assert.equal(result.serverInfo?.name, "zotero-reading-bridge");
      assert.deepEqual(result.capabilities?.tools, { listChanged: false });
      assert.equal(typeof result.instructions, "string");
      assert.ok(result.instructions.length > 0 && result.instructions.length <= 4000, `instructions length ${result.instructions.length}`);
      return { statusLine: init.http.statusLine, serverInfo: result.serverInfo, ms: init.ms, headers: init.http.rawHeaders };
    },
  };
}

async function toolsList(ctx: HarnessContext, path: string): Promise<any[]> {
  const outcome = await ctx.mcp(path).rpc("tools/list");
  assertJsonResponse(outcome.http, `tools/list on ${path}`);
  assert.ok(Array.isArray(outcome.message.result?.tools), "tools/list result.tools");
  return outcome.message.result.tools;
}

export const protocolCases: TestCase[] = [
  ...SUPPORTED_PROTOCOL_VERSIONS.map(initializeCase),
  {
    id: "protocol.initialize-unsupported-version",
    title: "initialize with an unknown version is answered with the 2025-11-25 baseline",
    requires: ["bridge"],
    async run(ctx) {
      const outcome = await ctx.mcp(ENDPOINT_PATH, "2024-11-05").rpc(
        "initialize",
        { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "zab-harness-old", version: "1" } },
        { versionHeader: null },
      );
      assert.equal(outcome.message.result?.protocolVersion, "2025-11-25");
    },
  },
  {
    id: "protocol.discover-probe",
    title: "server/discover probe (2026-07-28 header) gets HTTP 400 with -32601 echoing the id",
    requires: ["bridge"],
    async run(ctx) {
      for (const path of ENDPOINT_PATHS) {
        const result = await ctx.mcp(path).post({ jsonrpc: "2.0", id: "probe-1", method: "server/discover", params: {} }, { versionHeader: "2026-07-28" });
        assertRpcRejection(result, 400, JSONRPC_METHOD_NOT_FOUND, "probe-1", `probe on ${path}`);
      }
    },
  },
  {
    id: "protocol.unsupported-version-header",
    title: "A request with an unsupported MCP-Protocol-Version header gets 400 with -32600 echoing the id",
    requires: ["bridge"],
    async run(ctx) {
      const result = await ctx.mcp().post({ jsonrpc: "2.0", id: 77, method: "tools/list" }, { versionHeader: "2099-01-01" });
      assertRpcRejection(result, 400, JSONRPC_INVALID_REQUEST, 77, "unsupported header");
    },
  },
  {
    id: "protocol.notifications-202",
    title: "Notifications and response-only bodies get 202 with an empty body",
    requires: ["bridge"],
    async run(ctx) {
      const client = ctx.mcp();
      for (const [what, body] of [
        ["notification", { jsonrpc: "2.0", method: "notifications/initialized" }],
        ["cancel notification", { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }],
        ["response", { jsonrpc: "2.0", id: 5, result: {} }],
      ] as const) {
        const http = response(await client.post(body), what);
        assert.equal(http.status, 202, `${what}: HTTP ${http.status}`);
        assertReasonPhrase(http, "Accepted");
        assert.equal(http.bodyBytes, 0, `${what}: body ${http.body}`);
        assert.equal(http.headers["mcp-session-id"], undefined);
      }
    },
  },
  {
    id: "protocol.method-not-allowed",
    title: "GET, DELETE, PUT and PATCH get 405 with Allow: POST (no SSE stream)",
    requires: ["bridge"],
    async run(ctx) {
      const statuses: Record<string, number> = {};
      for (const method of ["GET", "DELETE", "PUT", "PATCH"]) {
        const body = method === "GET" ? undefined : "{}";
        const headers: Array<[string, string]> = [
          ["Host", `${LOOPBACK_HOST}:${ctx.port}`],
          ["User-Agent", "zab-harness/1.0"],
          ["Accept", "application/json, text/event-stream"],
        ];
        if (body !== undefined) headers.push(["Content-Type", "application/json"], ["Content-Length", String(body.length)]);
        const http = response(await rawRequest({ port: ctx.port, method, path: ENDPOINT_PATH, headers, body }), method);
        assert.equal(http.status, 405, `${method}: HTTP ${http.status} ${http.body.slice(0, 120)}`);
        assertReasonPhrase(http, "Method Not Allowed");
        assert.match(http.headers.allow ?? "", /\bPOST\b/, `${method}: Allow ${http.headers.allow}`);
        assert.notEqual(http.headers["content-type"], "text/event-stream");
        statuses[method] = http.status;
      }
      return statuses;
    },
  },
  {
    id: "protocol.browser-requests-refused",
    title: "Requests with an Origin header or a Mozilla/ User-Agent never get a usable response",
    requires: ["bridge"],
    async run(ctx) {
      const outcomes: Record<string, string> = {};
      const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
      for (const path of ENDPOINT_PATHS) {
        for (const [what, options] of [
          ["origin", { extraHeaders: [["Origin", "http://evil.example"]] as Array<[string, string]> }],
          ["null origin", { extraHeaders: [["Origin", "null"]] as Array<[string, string]> }],
          ["mozilla user-agent", { override: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }],
        ] as const) {
          const result = await ctx.mcp(path).post(ping, options);
          // Zotero itself drops most browser-looking requests before any endpoint runs; protocol.bookmarklet-origin
          // covers the ones it lets through, which the bridge's own access check (403) stops.
          const refused = result.dropped || result.response?.status === 403;
          assert.ok(refused, `${path} ${what}: ${result.response ? `HTTP ${result.response.status}` : result.error}`);
          if (result.response) assert.equal(result.response.headers["access-control-allow-origin"], undefined);
          outcomes[`${path} ${what}`] = result.dropped ? "dropped" : `HTTP ${result.response?.status}`;
        }
      }
      return outcomes;
    },
  },
  {
    id: "protocol.bookmarklet-origin",
    title: "Origin requests Zotero does not drop (connector headers, zotero.org CORS) reach the bridge and get 403",
    requires: ["bridge"],
    async run(ctx) {
      // A real tool call: if the Origin rule were missing, these would return library data.
      const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_status", arguments: {} } };
      const outcomes: Record<string, unknown> = {};
      const cases: Array<[string, Array<[string, string]>, Record<string, string>]> = [
        ["zotero.org + X-Zotero-Connector-API-Version", [["Origin", "https://www.zotero.org"], ["X-Zotero-Connector-API-Version", "3"]], {}],
        ["foreign origin + Zotero-Allowed-Request", [["Origin", "http://evil.example"], ["Zotero-Allowed-Request", "1"]], {}],
        [
          "browser User-Agent + zotero.org + connector header",
          [["Origin", "https://www.zotero.org"], ["X-Zotero-Connector-API-Version", "3"]],
          { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        ],
      ];
      for (const path of ENDPOINT_PATHS) {
        for (const [what, extraHeaders, override] of cases) {
          const http = response(await ctx.mcp(path).post(call, { extraHeaders, override }), `${path} ${what}`);
          assert.equal(http.status, 403, `${path} ${what}: HTTP ${http.status} ${http.body.slice(0, 200)}`);
          const body = jsonBody(http, `${path} ${what}`);
          assert.equal(body.result, undefined, "no tool result may leak");
          assert.equal(body.error?.code, -32000);
          // Zotero adds its own CORS header for https://www.zotero.org; the page can read only this 403.
          outcomes[`${path} ${what}`] = { status: http.status, allowOrigin: http.headers["access-control-allow-origin"] ?? null };
        }
      }
      // Recorded only (Zotero's behaviour, not the bridge's): the CORS preflight that makes the POST above possible.
      const preflight = await rawRequest({
        port: ctx.port,
        method: "OPTIONS",
        path: ENDPOINT_PATH,
        headers: [
          ["Host", `${LOOPBACK_HOST}:${ctx.port}`],
          ["Origin", "https://www.zotero.org"],
          ["Access-Control-Request-Method", "POST"],
          ["Access-Control-Request-Headers", "content-type,x-zotero-connector-api-version"],
          ["Connection", "close"],
        ],
      });
      outcomes["preflight"] = {
        status: preflight.response?.status ?? null,
        dropped: preflight.dropped,
        allowOrigin: preflight.response?.headers["access-control-allow-origin"] ?? null,
        allowHeaders: preflight.response?.headers["access-control-allow-headers"] ?? null,
      };
      return outcomes;
    },
  },
  {
    id: "protocol.host-check",
    title: "Foreign Host and wrong-port Host are rejected (httpd / Zotero 400; the bridge's own check 403)",
    requires: ["bridge"],
    async run(ctx) {
      const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
      const outcomes: Record<string, unknown> = {};
      for (const path of ENDPOINT_PATHS) {
        const client = ctx.mcp(path);
        // HTTP/1.1: Gecko's httpd rejects a Host that is not one of the server identities before Zotero runs,
        // with its generic "Bad Request" (not Zotero's "Invalid Host header").
        const foreign = response(await client.post(ping, { override: { host: `evil.example:${ctx.port}` } }), `${path} foreign host`);
        assert.equal(foreign.status, 400, `${path} foreign host: HTTP ${foreign.status}`);
        const wrongPort = response(await client.post(ping, { override: { host: `${LOOPBACK_HOST}:1` } }), `${path} wrong port`);
        assert.equal(wrongPort.status, 400, `${path} loopback host with wrong port (HTTP/1.1): HTTP ${wrongPort.status}`);
        // HTTP/1.0 skips httpd's identity check: Zotero's own regex rejects a foreign host name ("Invalid Host
        // header") but accepts any port, so only the bridge's access check stops a wrong port.
        const foreign10 = response(
          await client.post(ping, { override: { host: `evil.example:${ctx.port}` }, httpVersion: "1.0" }),
          `${path} foreign host over HTTP/1.0`,
        );
        assert.equal(foreign10.status, 400);
        assert.match(foreign10.body, /Invalid Host header/);
        const legacy = response(
          await client.post(ping, { override: { host: `${LOOPBACK_HOST}:1` }, httpVersion: "1.0" }),
          `${path} wrong port over HTTP/1.0`,
        );
        assert.equal(legacy.status, 403, `${path} loopback host with wrong port (HTTP/1.0): HTTP ${legacy.status} ${legacy.body.slice(0, 200)}`);
        assertJsonResponse(legacy, "403");
        const accepted: Record<string, number> = {};
        for (const host of [`localhost:${ctx.port}`, `${LOOPBACK_HOST}:${ctx.port}`]) {
          const http = response(await client.post(ping, { override: { host } }), `${path} ${host}`);
          assert.equal(http.status, 200, `${path} ${host}: HTTP ${http.status}`);
          accepted[host] = http.status;
        }
        // Recorded only: httpd's identities are IPv4 (the socket is IPv4-only), so "[::1]" is refused before
        // Zotero or the bridge see it; no client can reach the port over IPv6 anyway.
        const ipv6 = response(await client.post(ping, { override: { host: `[::1]:${ctx.port}` } }), `${path} [::1] host`);
        accepted[`[::1]:${ctx.port}`] = ipv6.status;
        outcomes[path] = {
          foreignHttp11: { status: foreign.status, body: foreign.body.trim().slice(0, 40) },
          wrongPortHttp11: wrongPort.status,
          foreignHttp10: { status: foreign10.status, body: foreign10.body.trim().slice(0, 40) },
          wrongPortHttp10: legacy.status,
          accepted,
        };
      }
      return outcomes;
    },
  },
  {
    id: "protocol.tools-list",
    title: "tools/list returns all tools with accurate effect annotations",
    requires: ["bridge"],
    async run(ctx) {
      const tools = await toolsList(ctx, ENDPOINT_PATH);
      assert.deepEqual(tools.map((t) => t.name), [...TOOL_NAMES]);
      for (const tool of tools) {
        assert.equal(tool.annotations?.readOnlyHint, tool.name !== "download_fulltext", `${tool.name} readOnlyHint`);
        assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} destructiveHint`);
        assert.equal(tool.inputSchema?.type, "object", `${tool.name} inputSchema`);
        assert.equal(tool.outputSchema, undefined, `${tool.name} must not declare outputSchema`);
      }
      return { count: tools.length };
    },
  },
  {
    id: "protocol.ping-and-unknown-method",
    title: "ping returns {}; unknown methods get -32601 with HTTP 200",
    requires: ["bridge"],
    async run(ctx) {
      const client = ctx.mcp();
      const ping = await client.rpc("ping");
      assert.deepEqual(ping.message.result, {});
      const unknown = await client.rpc("does/not/exist");
      assert.equal(unknown.http.status, 200);
      assert.equal(unknown.message.error?.code, JSONRPC_METHOD_NOT_FOUND);
    },
  },
  {
    id: "protocol.tool-call-errors",
    title: "Unknown tool / bad params are -32602; schema violations are isError INVALID_ARGUMENT",
    requires: ["bridge"],
    async run(ctx) {
      const client = ctx.mcp();
      const unknownTool = await client.rpc("tools/call", { name: "no_such_tool", arguments: {} });
      assert.equal(unknownTool.message.error?.code, JSONRPC_INVALID_PARAMS);
      const badArguments = await client.rpc("tools/call", { name: "get_items", arguments: "not-an-object" });
      assert.equal(badArguments.message.error?.code, JSONRPC_INVALID_PARAMS);
      const missingName = await client.rpc("tools/call", { arguments: {} });
      assert.equal(missingName.message.error?.code, JSONRPC_INVALID_PARAMS);
      const invalid = await client.toolError("get_items", { keys: ["not a key"] });
      assert.equal(invalid.code, "INVALID_ARGUMENT");
      const extra = await client.toolError("get_status", { unexpected: true });
      assert.equal(extra.code, "INVALID_ARGUMENT");
      const range = await client.toolError("list_libraries", { limit: 0 });
      assert.equal(range.code, "INVALID_ARGUMENT");
      return { invalid, extra, range };
    },
  },
  {
    id: "protocol.batches",
    title: "Batches are served only for 2025-03-26 (no header or that header); otherwise 400 -32600",
    requires: ["bridge"],
    async run(ctx) {
      const batch = [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ];
      for (const header of [null, "2025-03-26"]) {
        const http = response(await ctx.mcp().post(batch, { versionHeader: header }), `batch with header ${header}`);
        assert.equal(http.status, 200, `batch with header ${header}: HTTP ${http.status} ${http.body.slice(0, 200)}`);
        assertJsonResponse(http, "batch");
        const messages = jsonBody(http, "batch");
        assert.ok(Array.isArray(messages), "batch response must be an array");
        assert.deepEqual(messages.map((m: any) => m.id).sort(), [1, 2]);
      }
      const rejected = await ctx.mcp().post(batch, { versionHeader: "2025-11-25" });
      assertRpcRejection(rejected, 400, JSONRPC_INVALID_REQUEST, null, "batch with 2025-11-25");
      const initBatch = await ctx.mcp().post(
        [{ jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } }],
        { versionHeader: null },
      );
      const http = response(initBatch, "batched initialize");
      assert.ok(http.status === 400 || (http.status === 200 && JSON.stringify(jsonBody(http, "batched initialize")).includes('"error"')), `batched initialize: HTTP ${http.status} ${http.body.slice(0, 200)}`);
    },
  },
  {
    id: "protocol.accept-and-content-type",
    title: "Accept without JSON is 406, non-JSON Content-Type is 415, missing Accept and charset params are fine",
    requires: ["bridge"],
    async run(ctx) {
      const ping = { jsonrpc: "2.0", id: 3, method: "ping" };
      const notAcceptable = response(await ctx.mcp().post(ping, { override: { accept: "text/html" } }), "Accept text/html");
      assert.equal(notAcceptable.status, 406);
      assertReasonPhrase(notAcceptable, "Not Acceptable");
      const unsupported = response(await ctx.mcp().post(JSON.stringify(ping), { override: { "content-type": "text/plain" } }), "text/plain");
      assert.equal(unsupported.status, 415);
      assertReasonPhrase(unsupported, "Unsupported Media Type");
      const noAccept = response(await ctx.mcp().post(ping, { override: { accept: null } }), "no Accept");
      assert.equal(noAccept.status, 200);
      const wildcard = response(await ctx.mcp().post(ping, { override: { accept: "*/*" } }), "Accept */*");
      assert.equal(wildcard.status, 200);
      const charset = response(await ctx.mcp().post(ping, { override: { "content-type": "application/json; charset=utf-8" } }), "charset");
      assert.equal(charset.status, 200);
      // q=0 means "not acceptable" (RFC 9110), also when it is the most specific range next to a wildcard.
      for (const accept of ["application/json;q=0, text/event-stream", "*/*, application/json;q=0"]) {
        assert.equal(response(await ctx.mcp().post(ping, { override: { accept } }), accept).status, 406, accept);
      }
      return { notAcceptable: notAcceptable.status, unsupported: unsupported.status };
    },
  },
  {
    id: "protocol.malformed-bodies",
    title: "Malformed bodies are 4xx, never 5xx or a dropped connection",
    requires: ["bridge"],
    async run(ctx) {
      const statuses: Record<string, number> = {};
      for (const [what, body] of [
        ["invalid JSON", "{not json"],
        ["JSON string", '"hello"'],
        ["empty batch", "[]"],
        ["missing method", '{"jsonrpc":"2.0","id":4}'],
        ["wrong jsonrpc", '{"jsonrpc":"1.0","id":4,"method":"ping"}'],
      ] as const) {
        const http = response(await ctx.mcp().post(body), what);
        assert.ok(http.status >= 400 && http.status < 500, `${what}: HTTP ${http.status}`);
        statuses[what] = http.status;
      }
      // A well-formed request with non-object params is a JSON-RPC error (HTTP 200 + -32602), not silently accepted.
      const stringParams = response(await ctx.mcp().post('{"jsonrpc":"2.0","id":5,"method":"initialize","params":"2025-06-18"}'), "string params");
      assert.equal(stringParams.status, 200);
      assert.equal(jsonBody(stringParams, "string params").error?.code, JSONRPC_INVALID_PARAMS);
      statuses["initialize with string params"] = stringParams.status;
      return statuses;
    },
  },
  {
    id: "protocol.http-1.0",
    title: "An HTTP/1.0 request line is served",
    requires: ["bridge"],
    async run(ctx) {
      const http = response(await ctx.mcp().post({ jsonrpc: "2.0", id: 1, method: "ping" }, { httpVersion: "1.0" }), "HTTP/1.0");
      assert.equal(http.status, 200);
      return { statusLine: http.statusLine };
    },
  },
];
