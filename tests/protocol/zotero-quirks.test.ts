/**
 * Wire-level behaviour through the Zotero-like server: the bytes Zotero would write for our responses, and the
 * requests Zotero itself rejects before the endpoint runs.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { json } from "../../packages/zotero/src/tools/types.js";
import { fakeRegistry } from "../fixtures/fake-registry.js";
import {
  postJson,
  rawRequest,
  startZoteroLikeServer,
  type RawRequest,
  type RawResponse,
  type ZoteroLikeServer,
} from "./helpers/zotero-like-server.js";

const CHINESE_TITLE = "深度学习中的注意力机制：综述 😀";
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const V = { "MCP-Protocol-Version": "2025-11-25" };

let server: ZoteroLikeServer;

before(async () => {
  server = await startZoteroLikeServer({
    registry: fakeRegistry({
      get_status: async () => json({ title: CHINESE_TITLE }),
      get_schema: async () => {
        throw new Error("boom");
      },
    }),
  });
});

after(async () => {
  await server.close();
});

function send(request: RawRequest): Promise<RawResponse> {
  return rawRequest(server.port, request);
}

function rpcBody(method: string, params: unknown = {}, id: unknown = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** Run `fn` and report how many requests reached our handler meanwhile. */
async function handlerCalls<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = server.events.length;
  const result = await fn();
  return [result, server.events.length - start];
}

function assertJsonFraming(response: RawResponse): void {
  assert.match(response.statusLine, /^HTTP\/1\.0 \d{3} /);
  assert.equal(response.headers["content-type"], "application/json");
  assert.equal(response.headers["content-length"], String(response.bodyBytes));
  assert.equal(response.headers["connection"], "close");
  assert.equal(response.headerLines.filter((line) => /^content-length:/i.test(line)).length, 1);
  assert.equal(response.headers["mcp-session-id"], undefined);
  assert.ok(!response.headerLines.some((line) => /^access-control-/i.test(line)));
}

describe("response framing", () => {
  it("JSON responses: HTTP/1.0, lowercase application/json, exact Content-Length, Connection: close", async () => {
    const response = await send({ headers: JSON_HEADERS, body: rpcBody("initialize", { protocolVersion: "2025-11-25" }, 0) });
    assert.equal(response.statusLine, "HTTP/1.0 200 OK");
    assertJsonFraming(response);
    assert.equal(JSON.parse(response.body).result.protocolVersion, "2025-11-25");
  });

  it("Chinese and astral text: ASCII body whose length equals the byte count, decoded intact", async () => {
    const response = await send({ headers: { ...JSON_HEADERS, ...V }, body: rpcBody("tools/call", { name: "get_status", arguments: {} }) });
    assertJsonFraming(response);
    assert.match(response.body, /^[\x00-\x7f]*$/);
    const result = JSON.parse(response.body).result;
    assert.equal(JSON.parse(result.content[0].text).title, CHINESE_TITLE);
  });

  it("202 has exactly one Content-Length: 0 (added by Zotero) and no body", async () => {
    const response = await send({ headers: { ...JSON_HEADERS, ...V }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(response.statusLine, "HTTP/1.0 202 Accepted");
    assert.equal(response.headerLines.filter((line) => /^content-length:/i.test(line)).length, 1);
    assert.equal(response.headers["content-length"], "0");
    assert.equal(response.body, "");
  });

  it("GET and DELETE (with or without a body) get 405 with Allow: POST", async () => {
    for (const request of [
      { method: "GET", headers: { Accept: "text/event-stream", ...V } },
      { method: "DELETE", headers: { "Mcp-Session-Id": "x", ...V } },
      { method: "DELETE", headers: JSON_HEADERS, body: "{}" },
      { method: "PUT", headers: JSON_HEADERS, body: "{}" },
    ] satisfies RawRequest[]) {
      const response = await send(request);
      assert.equal(response.statusLine, "HTTP/1.0 405 Method Not Allowed", request.method);
      assert.equal(response.headers["allow"], "POST");
      assertJsonFraming(response);
    }
  });

  it("works even if the reason phrases were not patched (Zotero writes 'undefined')", async () => {
    const unpatched = await startZoteroLikeServer({ registry: fakeRegistry(), patchResponseCodes: false });
    try {
      const raw = await rawRequest(unpatched.port, { headers: { ...JSON_HEADERS, ...V }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
      assert.equal(raw.statusLine, "HTTP/1.0 202 undefined");
      const viaFetch = await postJson(unpatched, { jsonrpc: "2.0", method: "notifications/initialized" }, { headers: V });
      assert.equal(viaFetch.status, 202);
      const get = await fetch(unpatched.url(), { headers: V });
      assert.equal(get.status, 405);
      await get.body?.cancel();
    } finally {
      await unpatched.close();
    }
  });
});

describe("Zotero's own gatekeeping (before our endpoint runs)", () => {
  it("bad or missing Host: 400 text/plain", async () => {
    for (const host of ["evil.example", `evil.example:${0}`, "127.0.0.2", null]) {
      const [response, calls] = await handlerCalls(() => send({ headers: { Host: host, ...JSON_HEADERS }, body: rpcBody("ping") }));
      assert.equal(response.statusLine, "HTTP/1.0 400 Bad Request", String(host));
      assert.equal(response.body, "Invalid Host header\n");
      assert.equal(calls, 0);
    }
  });

  it("loopback Host with the wrong port passes Zotero but gets our 403", async () => {
    const [response, calls] = await handlerCalls(() => send({ headers: { Host: "localhost:1", ...JSON_HEADERS }, body: rpcBody("ping") }));
    assert.equal(response.status, 403);
    assertJsonFraming(response);
    assert.equal(calls, 1);
    const ipv6 = await send({ headers: { Host: `[::1]:${server.port}`, ...JSON_HEADERS }, body: rpcBody("ping") });
    assert.equal(ipv6.status, 200);
  });

  it("Origin or a Mozilla/ User-Agent: connection dropped without a response", async () => {
    const browserHeaders: Array<Record<string, string>> = [
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { "User-Agent": "Mozilla/5.0 (Windows NT 10.0)" },
    ];
    for (const headers of browserHeaders) {
      const [response, calls] = await handlerCalls(() => send({ headers: { ...JSON_HEADERS, ...headers }, body: rpcBody("ping") }));
      assert.equal(response.dropped, true, JSON.stringify(headers));
      assert.equal(calls, 0);
    }
  });

  it("our 403 still applies if a browser request gets past Zotero", async () => {
    const response = await send({ headers: { ...JSON_HEADERS, Origin: "https://evil.example", "Zotero-Allowed-Request": "1" }, body: rpcBody("ping") });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body).error.code, -32000);
  });

  it("POST without Content-Length (chunked): 400 text/plain", async () => {
    const [response, calls] = await handlerCalls(() => send({ headers: JSON_HEADERS, body: rpcBody("ping"), chunked: true }));
    assert.equal(response.status, 400);
    assert.equal(response.body, "Content-length not provided\n");
    assert.equal(calls, 0);
  });

  it("invalid JSON: 400 text/plain 'Invalid JSON provided', handler never runs", async () => {
    for (const body of ["{", "not json", '{"jsonrpc":"2.0",}']) {
      const [response, calls] = await handlerCalls(() => send({ headers: JSON_HEADERS, body }));
      assert.equal(response.statusLine, "HTTP/1.0 400 Bad Request");
      assert.equal(response.headers["content-type"], "text/plain");
      assert.equal(response.body, "Invalid JSON provided\n");
      assert.equal(calls, 0);
    }
  });

  it("unknown paths: 404 text/plain; HEAD: 200 without reaching the endpoint", async () => {
    const missing = await send({ path: "/bridge/mcp/extra", headers: JSON_HEADERS, body: rpcBody("ping") });
    assert.equal(missing.status, 404);
    const [head, calls] = await handlerCalls(() => send({ method: "HEAD" }));
    assert.equal(head.statusLine, "HTTP/1.0 200 OK");
    assert.equal(calls, 0);
  });

  it("a query string does not change routing", async () => {
    const response = await send({ path: "/bridge/mcp?client=claude-code", headers: { ...JSON_HEADERS, ...V }, body: rpcBody("ping") });
    assert.equal(response.status, 200);
  });
});

describe("content types as Zotero delivers them", () => {
  it("application/json with parameters is parsed by Zotero and accepted", async () => {
    const response = await send({ headers: { ...JSON_HEADERS, "Content-Type": "application/json; charset=utf-8", ...V }, body: rpcBody("ping") });
    assert.equal(response.status, 200);
  });

  it("other media types reach us unparsed and get 415", async () => {
    for (const type of ["text/plain", "application/octet-stream"]) {
      const response = await send({ headers: { ...JSON_HEADERS, "Content-Type": type }, body: rpcBody("ping") });
      assert.equal(response.statusLine, "HTTP/1.0 415 Unsupported Media Type", type);
      assertJsonFraming(response);
    }
    const none = await send({ headers: { Accept: "application/json" }, body: rpcBody("ping") });
    assert.equal(none.status, 415);
  });

  it("a differently-cased JSON media type is not parsed by Zotero: 400 -32700", async () => {
    const response = await send({ headers: { ...JSON_HEADERS, "Content-Type": "Application/JSON" }, body: rpcBody("ping") });
    assert.equal(response.status, 400);
    assert.equal(JSON.parse(response.body).error.code, -32700);
  });

  it("an empty JSON body (Zotero parses it as null): 400 -32600", async () => {
    const response = await send({ headers: JSON_HEADERS, body: "" });
    assert.equal(response.status, 400);
    assert.equal(JSON.parse(response.body).error.code, -32600);
  });

  it("Accept excluding JSON: 406", async () => {
    const response = await send({ headers: { ...JSON_HEADERS, Accept: "text/event-stream" }, body: rpcBody("ping") });
    assert.equal(response.statusLine, "HTTP/1.0 406 Not Acceptable");
  });
});

describe("protocol over fetch", () => {
  it("server/discover probe: 400 application/json echoing the id with -32601", async () => {
    const probe = await postJson(server, { jsonrpc: "2.0", id: "server-discover-probe-1", method: "server/discover", params: {} }, { headers: { "mcp-protocol-version": "2026-07-28" } });
    assert.equal(probe.status, 400);
    assert.equal(probe.headers.get("content-type"), "application/json");
    assert.deepEqual(probe.json, {
      jsonrpc: "2.0",
      id: "server-discover-probe-1",
      error: { code: -32601, message: probe.json.error.message },
    });
  });

  it("unsupported MCP-Protocol-Version: 400 -32600 echoing the id", async () => {
    const response = await postJson(server, { jsonrpc: "2.0", id: 42, method: "tools/list" }, { headers: { "mcp-protocol-version": "2099-01-01" } });
    assert.equal(response.status, 400);
    assert.deepEqual([response.json.id, response.json.error.code], [42, -32600]);
  });

  it("batches: processed without a header, rejected for 2025-06-18+", async () => {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: 1, progress: 1 } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ];
    const legacy = await postJson(server, batch);
    assert.equal(legacy.status, 200);
    assert.deepEqual(
      legacy.json.map((entry: { id: number }) => entry.id),
      [1, 2],
    );
    for (const version of ["2025-06-18", "2025-11-25"]) {
      const rejected = await postJson(server, batch, { headers: { "mcp-protocol-version": version } });
      assert.equal(rejected.status, 400, version);
      assert.equal(rejected.json.error.code, -32600);
    }
  });

  it("unknown tool: HTTP 200 with -32602; invalid arguments: isError result", async () => {
    const unknown = await postJson(server, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "write_items", arguments: {} } }, { headers: V });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.json.error.code, -32602);

    const invalid = await postJson(server, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_items", arguments: { keys: [] } } }, { headers: V });
    assert.equal(invalid.status, 200);
    assert.equal(invalid.json.result.isError, true);
    assert.equal(JSON.parse(invalid.json.result.content[0].text).error.code, "INVALID_ARGUMENT");
  });

  it("a throwing handler never produces a 5xx", async () => {
    const response = await postJson(server, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_schema", arguments: {} } }, { headers: V });
    assert.equal(response.status, 200);
    assert.equal(response.json.result.isError, true);
    assert.ok(!response.text.includes("boom"));
  });

  it("never returns Mcp-Session-Id, even when the client sends one", async () => {
    const response = await postJson(server, { jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-11-25" } }, { headers: { "mcp-session-id": "abc" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("mcp-session-id"), null);
  });

  it("the Content-Length header matches the received bytes for Chinese results", async () => {
    const response = await fetch(server.url(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...V },
      body: rpcBody("tools/call", { name: "get_status", arguments: {} }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.headers.get("content-length"), String(bytes.length));
    assert.equal(JSON.parse(JSON.parse(bytes.toString("utf8")).result.content[0].text).title, CHINESE_TITLE);
  });
});
