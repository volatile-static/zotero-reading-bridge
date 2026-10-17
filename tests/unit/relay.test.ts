/**
 * The Claude Desktop stdio <-> HTTP relay (packages/claude-desktop/src/relay.ts): argument parsing (loopback only),
 * line framing, response forwarding, synthesized errors for an unreachable Zotero, and the exact request headers.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { after, before, describe, it } from "node:test";
import {
  RELAY_ERROR_CODE,
  RELAY_NAME,
  UsageError,
  describeMessage,
  parseRelayArgs,
  runRelay,
  type HttpResult,
  type PostRequest,
} from "../../packages/claude-desktop/src/relay.js";

describe("parseRelayArgs", () => {
  it("defaults to Zotero's port and accepts --port in both spellings", () => {
    assert.deepEqual(parseRelayArgs([]), { port: 23119 });
    assert.deepEqual(parseRelayArgs(["--port", "23139"]), { port: 23139 });
    assert.deepEqual(parseRelayArgs(["--port=8080"]), { port: 8080 });
    assert.deepEqual(parseRelayArgs(["--port", "23119.0"]), { port: 23119 }, "MCPB may render numbers with a fraction");
  });

  it("accepts --host only when it is exactly 127.0.0.1", () => {
    assert.deepEqual(parseRelayArgs(["--host", "127.0.0.1", "--port", "1"]), { port: 1 });
    for (const host of ["localhost", "::1", "[::1]", "0.0.0.0", "192.168.1.10", "example.com", "127.0.0.2", ""]) {
      assert.throws(() => parseRelayArgs(["--host", host]), UsageError, host);
      assert.throws(() => parseRelayArgs([`--host=${host}`]), UsageError, host);
    }
    assert.throws(() => parseRelayArgs(["--host"]), UsageError);
  });

  it("rejects bad ports and unknown arguments", () => {
    for (const port of ["0", "65536", "-1", "abc", "1e3", "23119.5", ""]) {
      assert.throws(() => parseRelayArgs(["--port", port]), UsageError, port);
    }
    assert.throws(() => parseRelayArgs(["--port"]), UsageError);
    assert.throws(() => parseRelayArgs(["--url", "http://example.com/"]), UsageError);
    assert.throws(() => parseRelayArgs(["23119"]), UsageError);
  });
});

describe("describeMessage", () => {
  it("finds request ids, methods and initialize ids; notifications and junk have no ids", () => {
    assert.deepEqual(describeMessage('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'), {
      requestIds: [1],
      methods: ["initialize"],
      initializeIds: [1],
    });
    assert.deepEqual(describeMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}').requestIds, []);
    assert.deepEqual(describeMessage('{"jsonrpc":"2.0","id":"a","result":{}}').requestIds, [], "responses are not requests");
    assert.deepEqual(describeMessage("not json").requestIds, []);
    assert.deepEqual(describeMessage('[{"jsonrpc":"2.0","id":2,"method":"ping"},{"jsonrpc":"2.0","method":"x"}]').requestIds, [2]);
  });
});

interface Harness {
  input: PassThrough;
  lines: () => string[];
  done: Promise<void>;
  requests: PostRequest[];
}

function harness(respond: (request: PostRequest) => Promise<HttpResult>, port = 23119): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
  const requests: PostRequest[] = [];
  const done = runRelay(
    { port },
    {
      input,
      output,
      version: "9.9.9",
      post: (request) => {
        requests.push(request);
        return respond(request);
      },
    },
  );
  return { input, lines: () => text.split("\n").filter(Boolean), done, requests };
}

const json = (status: number, value: unknown): HttpResult => ({ status, body: Buffer.from(JSON.stringify(value, null, 2)) });

describe("runRelay", () => {
  it("forwards each line verbatim, writes JSON responses as single lines and nothing for 202", async () => {
    const h = harness(async (request) => {
      const message = JSON.parse(request.body.toString("utf8"));
      if (!("id" in message)) return { status: 202, body: Buffer.alloc(0) };
      return json(200, { jsonrpc: "2.0", id: message.id, result: { text: "第一行\n第二行" } });
    });
    const call = '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_status","arguments":{}}}';
    h.input.write(`${call}\r\n\n   \n{"jsonrpc":"2.0","method":"notifications/initialized"}\n`);
    h.input.end();
    await h.done;
    assert.equal(h.requests.length, 2, "blank lines are not forwarded");
    assert.equal(h.requests[0]?.body.toString("utf8"), call);
    assert.deepEqual(h.lines(), ['{"jsonrpc":"2.0","id":5,"result":{"text":"第一行\\n第二行"}}']);
  });

  it("forwards JSON-RPC error bodies of 4xx responses (e.g. the server/discover probe)", async () => {
    const h = harness(async () => json(400, { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }));
    h.input.end('{"jsonrpc":"2.0","id":1,"method":"server/discover"}\n');
    await h.done;
    assert.deepEqual(JSON.parse(h.lines()[0] ?? ""), { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } });
  });

  it("answers every request with a JSON-RPC error when Zotero is unreachable, and stays silent for notifications", async () => {
    const h = harness(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:23119"), { code: "ECONNREFUSED" });
    });
    h.input.write('{"jsonrpc":"2.0","id":"a","method":"initialize","params":{}}\n');
    h.input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    h.input.end('{"jsonrpc":"2.0","id":0,"method":"tools/list"}\n');
    await h.done;
    const replies = h.lines().map((line) => JSON.parse(line));
    assert.deepEqual(replies.map((r) => r.id).sort(), [0, "a"]);
    for (const reply of replies) {
      assert.equal(reply.error.code, RELAY_ERROR_CODE);
      assert.match(reply.error.message, /http:\/\/127\.0\.0\.1:23119\/bridge\/mcp \(ECONNREFUSED\)/);
    }
  });

  it("turns non-JSON answers (plugin disabled: 404 text) into errors that say what to do", async () => {
    const h = harness(async () => ({ status: 404, body: Buffer.from("No endpoint found\n") }));
    h.input.end('{"jsonrpc":"2.0","id":3,"method":"tools/list"}\n');
    await h.done;
    const reply = JSON.parse(h.lines()[0] ?? "");
    assert.equal(reply.id, 3);
    assert.match(reply.error.message, /HTTP 404.*Tools > Plugins/);
  });

  it("does not answer a request twice when slow and fast responses interleave", async () => {
    const h = harness(async (request) => {
      const message = JSON.parse(request.body.toString("utf8"));
      if (message.id === 1) await new Promise((resolve) => setTimeout(resolve, 50));
      return json(200, { jsonrpc: "2.0", id: message.id, result: {} });
    });
    h.input.write('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}\n');
    h.input.end('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    await h.done;
    assert.deepEqual(h.lines().map((line) => JSON.parse(line).id), [2, 1], "the ping is not held back by the slow call");
  });
});

describe("runRelay over real HTTP", () => {
  let server: http.Server;
  let port = 0;
  const seen: { headers: http.IncomingHttpHeaders; method?: string; url?: string; body: string }[] = [];

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        seen.push({ headers: req.headers, method: req.method, url: req.url, body });
        const message = JSON.parse(body);
        if (!("id" in message)) {
          res.writeHead(202).end();
          return;
        }
        const result = message.method === "initialize" ? { protocolVersion: "2025-06-18" } : {};
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("POSTs to 127.0.0.1/bridge/mcp with JSON headers, a relay User-Agent, no Origin, and the negotiated version afterwards", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const out: string[] = [];
    output.on("data", (chunk: Buffer) => out.push(chunk.toString("utf8")));
    const done = runRelay({ port }, { input, output, version: "1.2.3" });
    input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    input.end('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    await done;

    assert.equal(seen.length, 3);
    for (const request of seen) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/bridge/mcp");
      assert.equal(request.headers.host, `127.0.0.1:${port}`);
      assert.equal(request.headers["content-type"], "application/json");
      assert.equal(request.headers.accept, "application/json");
      assert.equal(request.headers["user-agent"], `${RELAY_NAME}/1.2.3`);
      assert.ok(!("origin" in request.headers), "never an Origin header");
      assert.equal(request.headers["content-length"], String(Buffer.byteLength(request.body)));
    }
    assert.equal(seen[0]?.headers["mcp-protocol-version"], undefined, "initialize itself carries no version header");
    assert.equal(seen[1]?.headers["mcp-protocol-version"], "2025-06-18");
    assert.equal(seen[2]?.headers["mcp-protocol-version"], "2025-06-18");
    const lines = out.join("").split("\n").filter(Boolean);
    assert.deepEqual(lines.map((line) => JSON.parse(line).id), [1, 2]);
  });
});
