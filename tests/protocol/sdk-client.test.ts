/**
 * The official MCP TypeScript SDK client (@modelcontextprotocol/sdk 1.32.1, Client + StreamableHTTPClientTransport)
 * against the Zotero-like server, plus raw-fetch replays of the Codex and Claude Code connect sequences.
 *
 * The SDK always requests LATEST_PROTOCOL_VERSION (2025-11-25) and has no option to change it, so the 2025-06-18
 * run rewrites the initialize request in a fetch wrapper; everything after that (accepting the echoed version,
 * sending it as MCP-Protocol-Version) is the SDK's own behaviour, i.e. what Codex does with 2025-06-18.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { ENDPOINT_PATHS } from "../../shared/types/bridge.js";
import { TOOL_NAMES } from "../../shared/types/tool-names.js";
import { text, ToolError } from "../../packages/zotero/src/tools/types.js";
import { fakeRegistry } from "../fixtures/fake-registry.js";
import { postJson, startZoteroLikeServer, TEST_SERVER_VERSION, type ZoteroLikeServer } from "./helpers/zotero-like-server.js";

const HOOK_JSON = '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Zotero: 当前选中 1 个条目"}}';

interface Exchange {
  method: string;
  headers: Record<string, string>;
  body: any;
  status: number;
  responseHeaders: Record<string, string>;
}

function recordingFetch(log: Exchange[], initializeVersion?: string) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    let body = init?.body;
    let parsed: any;
    if (typeof body === "string") {
      parsed = JSON.parse(body);
      if (initializeVersion && parsed.method === "initialize") {
        parsed.params.protocolVersion = initializeVersion;
        body = JSON.stringify(parsed);
      }
    }
    const response = await fetch(url, { ...init, body });
    log.push({
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: parsed,
      status: response.status,
      responseHeaders: Object.fromEntries(response.headers.entries()),
    });
    return response;
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

let server: ZoteroLikeServer;

before(async () => {
  server = await startZoteroLikeServer({
    registry: fakeRegistry({
      capture_prompt_context: async () => text(HOOK_JSON),
      get_attachment_path: async () => {
        throw new ToolError("NOT_FOUND", "Attachment not found");
      },
      get_schema: async () => {
        throw new Error("unexpected");
      },
    }),
  });
});

after(async () => {
  await server.close();
});

for (const version of ["2025-11-25", "2025-06-18"] as const) {
  for (const path of ENDPOINT_PATHS) {
    describe(`SDK client, protocol ${version}, ${path}`, () => {
      const log: Exchange[] = [];
      const errors: unknown[] = [];
      let client: Client;
      let transport: StreamableHTTPClientTransport;

      before(async () => {
        client = new Client({ name: "sdk-test", version: "1.0.0" });
        client.onerror = (error) => errors.push(error);
        transport = new StreamableHTTPClientTransport(new URL(server.url(path)), {
          fetch: recordingFetch(log, version === "2025-11-25" ? undefined : version),
        });
        await client.connect(transport);
      });

      after(async () => {
        await client.close();
      });

      it("initializes and negotiates the requested version", () => {
        assert.equal(transport.protocolVersion, version);
        assert.deepEqual(client.getServerVersion(), { name: "zotero-reading-bridge", title: "Zotero Reading Bridge", version: TEST_SERVER_VERSION });
        assert.deepEqual(client.getServerCapabilities(), { tools: { listChanged: false } });
        assert.equal(client.getInstructions(), "Test instructions.");
        const [initialize] = log;
        assert.equal(initialize?.body.method, "initialize");
        assert.equal(initialize?.headers["mcp-protocol-version"], undefined, "initialize carries no version header");
        assert.match(initialize?.headers["accept"] ?? "", /application\/json/);
      });

      it("lists all tools", async () => {
        const { tools, nextCursor } = await client.listTools();
        assert.equal(nextCursor, undefined);
        assert.deepEqual(
          tools.map((tool) => tool.name),
          [...TOOL_NAMES],
        );
        for (const tool of tools) {
          assert.equal(tool.annotations?.readOnlyHint, tool.name !== "download_fulltext");
          assert.equal(tool.outputSchema, undefined);
        }
      });

      it("calls a tool with defaults applied and Chinese text intact", async () => {
        const result = await client.callTool({ name: "search_items", arguments: { query: "注意力机制", limit: 5 } });
        assert.ok(!result.isError);
        const content = result.content as Array<{ type: string; text: string }>;
        const payload = JSON.parse(content[0]!.text);
        assert.equal(payload.tool, "search_items");
        assert.deepEqual(payload.args, {
          query: "注意力机制",
          limit: 5,
          mode: "titleCreatorYear",
          includeChildItems: false,
          sort: "dateModified",
          direction: "desc",
        });
        assert.deepEqual(payload.ctx, { protocolVersion: version, endpointPath: path });
      });

      it("returns hook JSON verbatim as the single text item", async () => {
        const result = await client.callTool({ name: "capture_prompt_context", arguments: { client: "codex", session_id: "s1", turn_id: "t1" } });
        assert.deepEqual(result.content, [{ type: "text", text: HOOK_JSON }]);
        assert.ok(!result.isError);
      });

      it("reports invalid arguments, ToolErrors and handler crashes as isError results", async () => {
        const invalid = await client.callTool({ name: "search_items", arguments: { limit: 0 } });
        assert.equal(invalid.isError, true);
        const invalidText = (invalid.content as Array<{ text: string }>)[0]!.text;
        assert.equal(JSON.parse(invalidText).error.code, "INVALID_ARGUMENT");

        const notFound = await client.callTool({ name: "get_attachment_path", arguments: { key: "ABCD2345" } });
        assert.equal(notFound.isError, true);
        assert.equal(JSON.parse((notFound.content as Array<{ text: string }>)[0]!.text).error.code, "NOT_FOUND");

        const crashed = await client.callTool({ name: "get_schema", arguments: {} });
        assert.equal(crashed.isError, true);
        assert.equal(JSON.parse((crashed.content as Array<{ text: string }>)[0]!.text).error.code, "INTERNAL");
      });

      it("rejects unknown tools with JSON-RPC -32602", async () => {
        await assert.rejects(
          client.callTool({ name: "delete_everything", arguments: {} }),
          (error: unknown) => error instanceof McpError && error.code === -32602,
        );
      });

      it("answers ping", async () => {
        assert.deepEqual(await client.ping(), {});
      });

      it("sent the negotiated version on every later request and never got a session id", async () => {
        // The SDK opens its optional GET SSE stream asynchronously after notifications/initialized.
        assert.ok(await waitFor(() => log.some((exchange) => exchange.method === "GET")), "SDK tried the GET stream");
        for (const exchange of log.slice(1)) {
          assert.equal(exchange.headers["mcp-protocol-version"], version, `${exchange.method} ${exchange.body?.method ?? ""}`);
        }
        for (const exchange of log) {
          assert.equal(exchange.responseHeaders["mcp-session-id"], undefined);
          assert.ok(exchange.status < 500);
        }
        const initialized = log.find((exchange) => exchange.body?.method === "notifications/initialized");
        assert.equal(initialized?.status, 202);
        assert.deepEqual(
          log.filter((exchange) => exchange.method === "GET").map((exchange) => exchange.status),
          [405],
          "GET answered 405, which the SDK treats as 'no SSE stream'",
        );
        assert.deepEqual(errors, [], "no transport errors surfaced");
      });

      it("needs no Authorization: initialize, tools/list and tools/call all succeeded without one", () => {
        const methods = log.map((exchange) => exchange.body?.method).filter(Boolean);
        for (const method of ["initialize", "tools/list", "tools/call"]) assert.ok(methods.includes(method), method);
        for (const exchange of log) {
          assert.equal(exchange.headers["authorization"], undefined, `${exchange.method} ${exchange.body?.method ?? ""}`);
        }
        assert.ok(log.filter((exchange) => exchange.method === "POST").every((exchange) => exchange.status === 200 || exchange.status === 202));
      });
    });
  }
}

describe("raw client sequences", () => {
  it("Codex (legacy mode): initialize 2025-06-18, initialized, tools/list, tools/call", async () => {
    const accept = { accept: "text/event-stream, application/json" };
    const init = await postJson(
      server,
      { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "codex-mcp-client", title: "Codex", version: "0.162.0" } } },
      { path: "/bridge/mcp", headers: accept },
    );
    assert.equal(init.status, 200);
    assert.equal(init.headers.get("content-type"), "application/json", "exact lowercase media type (Codex starts_with check)");
    assert.equal(init.json.result.protocolVersion, "2025-06-18");

    const headers = { ...accept, "mcp-protocol-version": "2025-06-18" };
    const initialized = await postJson(server, { jsonrpc: "2.0", method: "notifications/initialized" }, { path: "/bridge/mcp", headers });
    assert.equal(initialized.status, 202);
    assert.equal(initialized.text, "");

    const list = await postJson(server, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { path: "/bridge/mcp", headers });
    assert.equal(list.json.result.tools.length, TOOL_NAMES.length);

    const hook = await postJson(
      server,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "capture_prompt_context", arguments: { client: "codex", session_id: "s", turn_id: "t" }, _meta: { threadId: "s" } } },
      { path: "/bridge/mcp", headers },
    );
    assert.deepEqual(hook.json.result.content, [{ type: "text", text: HOOK_JSON }]);
  });

  it("Claude Code (auto mode): server/discover probe is answered 'legacy', then initialize 2025-11-25", async () => {
    const probe = await postJson(
      server,
      {
        jsonrpc: "2.0",
        id: "server-discover-probe-1",
        method: "server/discover",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.1.295" } } },
      },
      { headers: { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover", "user-agent": "claude-code/2.1.295 (external, cli)" } },
    );
    assert.equal(probe.status, 400);
    assert.equal(probe.headers.get("content-type"), "application/json");
    assert.deepEqual([probe.json.id, probe.json.error.code], ["server-discover-probe-1", -32601]);

    const init = await postJson(server, {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { roots: {}, elicitation: {} }, clientInfo: { name: "claude-code", title: "Claude Code", version: "2.1.295" } },
    });
    assert.equal(init.json.result.protocolVersion, "2025-11-25");
  });
});
