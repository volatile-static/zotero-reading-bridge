/**
 * End to end through the Claude Desktop relay the way Claude Desktop runs it: the official MCP SDK client with a stdio
 * transport spawns the relay entry point (packages/claude-desktop/src/main.ts, under tsx) as a child process, and the
 * relay talks HTTP to the Zotero-like server.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOL_NAMES } from "../../shared/types/tool-names.js";
import { fakeRegistry } from "../fixtures/fake-registry.js";
import { TEST_SERVER_VERSION, startZoteroLikeServer, type ZoteroLikeServer } from "./helpers/zotero-like-server.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const RELAY_ENTRY = path.join(REPO_ROOT, "packages", "claude-desktop", "src", "main.ts");

function relayTransport(port: number): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", RELAY_ENTRY, "--port", String(port)],
    cwd: REPO_ROOT,
    stderr: "pipe",
  });
}

describe("MCP SDK stdio client -> relay -> Zotero-like server", () => {
  let server: ZoteroLikeServer;

  before(async () => {
    server = await startZoteroLikeServer({ registry: fakeRegistry(), instructions: "Use the Zotero tools." });
  });
  after(() => server.close());

  it("initializes, lists all tools and calls one", async () => {
    const client = new Client({ name: "relay-test", version: "0.0.0" });
    await client.connect(relayTransport(server.port));
    try {
      assert.equal(client.getServerVersion()?.version, TEST_SERVER_VERSION);
      assert.equal(client.getInstructions(), "Use the Zotero tools.");
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
      const result = await client.callTool({ name: "get_status", arguments: {} });
      assert.notEqual(result.isError, true);
    } finally {
      await client.close();
    }
    const methods = server.events.map((event) => event.rpcMethod);
    assert.ok(methods.includes("initialize") && methods.includes("tools/list") && methods.includes("tools/call"), methods.join(","));
  });

  it("reports an unreachable Zotero as a failed initialize instead of hanging", async () => {
    const closed = await startZoteroLikeServer({ registry: fakeRegistry() });
    const port = closed.port;
    await closed.close();
    const client = new Client({ name: "relay-test", version: "0.0.0" });
    await assert.rejects(client.connect(relayTransport(port)), /Cannot reach the Zotero AI Bridge/);
    await client.close();
  });
});
