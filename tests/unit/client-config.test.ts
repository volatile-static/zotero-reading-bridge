import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  claudeCodeAddCommand,
  claudeCodeHookSettingsJson,
  codexConfigToml,
  resolveBridgeStatus,
  type BridgeStatusInputs,
} from "../../packages/zotero/src/settings/client-config.js";
import { endpointUrl } from "../../shared/types/bridge.js";
import { CLIENT_SERVER_NAMES } from "../../shared/types/hook.js";

const URL_23119 = "http://127.0.0.1:23119/bridge/mcp";

function readJson(rel: string): unknown {
  return JSON.parse(fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
}

describe("codexConfigToml", () => {
  const toml = codexConfigToml(endpointUrl(23119));

  it("renders the zotero_bridge server block and the plugin-equivalent hook", () => {
    assert.equal(
      toml,
      [
        "# Zotero AI Bridge: read-only access to the local Zotero library (Zotero must be running).",
        "# Use either this manual configuration or the Codex plugin, not both.",
        "[mcp_servers.zotero_bridge]",
        `url = "${URL_23119}"`,
        "startup_timeout_sec = 10",
        "tool_timeout_sec = 30",
        "",
        "# Optional: attach the current Zotero selection to each prompt. Codex asks you to trust the hook once (/hooks).",
        "[[hooks.UserPromptSubmit]]",
        "",
        "[[hooks.UserPromptSubmit.hooks]]",
        'type = "mcp_tool"',
        'server = "zotero_bridge"',
        'tool = "capture_prompt_context"',
        "timeout = 5",
        'statusMessage = "Reading Zotero context"',
        "",
        "[hooks.UserPromptSubmit.hooks.input]",
        'client = "codex"',
        'session_id = "${session_id}"',
        'turn_id = "${turn_id}"',
        "",
      ].join("\n"),
    );
  });

  it("uses the server key the hook references", () => {
    assert.match(toml, new RegExp(`^\\[mcp_servers\\.${CLIENT_SERVER_NAMES.codex}\\]$`, "m"));
    assert.match(toml, new RegExp(`^server = "${CLIENT_SERVER_NAMES.codex}"$`, "m"));
  });

  it("matches the Codex plugin's server timeouts and hook", () => {
    const mcp = readJson("packages/codex/.mcp.json") as { mcpServers: Record<string, Record<string, unknown>> };
    const server = mcp.mcpServers[CLIENT_SERVER_NAMES.codex];
    assert.ok(server, "the Codex plugin declares the zotero_bridge server");
    assert.match(toml, new RegExp(`^startup_timeout_sec = ${String(server["startup_timeout_sec"])}$`, "m"));
    assert.match(toml, new RegExp(`^tool_timeout_sec = ${String(server["tool_timeout_sec"])}$`, "m"));

    const hooks = readJson("packages/codex/hooks/hooks.json") as {
      hooks: { UserPromptSubmit: Array<{ hooks: Array<Record<string, unknown>> }> };
    };
    const hook = hooks.hooks.UserPromptSubmit[0]?.hooks[0];
    assert.ok(hook, "the Codex plugin declares a UserPromptSubmit hook");
    for (const key of ["type", "server", "tool", "timeout", "statusMessage"]) {
      assert.match(toml, new RegExp(`^${key} = ${JSON.stringify(hook[key]).replace(/[$()]/g, "\\$&")}$`, "m"), key);
    }
    const input = hook["input"] as Record<string, string>;
    const tomlInput = toml.slice(toml.indexOf("[hooks.UserPromptSubmit.hooks.input]")).trim().split("\n").slice(1);
    assert.deepEqual(tomlInput.sort(), Object.entries(input).map(([key, value]) => `${key} = "${value}"`).sort());
  });

  it("never sends the prompt text", () => {
    assert.ok(!toml.includes("${prompt}"));
  });

  it("follows the actual port", () => {
    assert.match(codexConfigToml(endpointUrl(23139)), /^url = "http:\/\/127\.0\.0\.1:23139\/bridge\/mcp"$/m);
  });

  it("escapes characters TOML basic strings cannot hold literally", () => {
    const line = codexConfigToml('a"b\\c\nd\u007fe\tf')
      .split("\n")
      .find((l) => l.startsWith("url = "));
    assert.equal(line, 'url = "a\\"b\\\\c\\u000ad\\u007fe\tf"');
  });
});

describe("claudeCodeAddCommand", () => {
  it("registers an HTTP server named zotero_bridge in user scope", () => {
    assert.equal(claudeCodeAddCommand(URL_23119), `claude mcp add --transport http --scope user zotero_bridge ${URL_23119}`);
  });

  it("uses a manual name distinct from the bare \"zotero\" other Zotero MCP servers often take", () => {
    assert.equal(CLIENT_SERVER_NAMES.claudeCodeManual, CLIENT_SERVER_NAMES.codex);
    assert.notEqual(CLIENT_SERVER_NAMES.claudeCodeManual, "zotero");
  });
});

describe("claudeCodeHookSettingsJson", () => {
  const settings = JSON.parse(claudeCodeHookSettingsJson(CLIENT_SERVER_NAMES.claudeCodeManual));

  it("has exactly one UserPromptSubmit group without a matcher", () => {
    assert.deepEqual(Object.keys(settings), ["hooks"]);
    assert.deepEqual(Object.keys(settings.hooks), ["UserPromptSubmit"]);
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.deepEqual(Object.keys(settings.hooks.UserPromptSubmit[0]), ["hooks"]);
  });

  it("calls capture_prompt_context with ids only and a 5 s integer timeout", () => {
    const [hook, ...rest] = settings.hooks.UserPromptSubmit[0].hooks;
    assert.equal(rest.length, 0);
    assert.deepEqual(hook, {
      type: "mcp_tool",
      server: "zotero_bridge",
      tool: "capture_prompt_context",
      input: { client: "claude-code", session_id: "${session_id}", prompt_id: "${prompt_id}" },
      timeout: 5,
      statusMessage: "Reading Zotero context",
    });
    assert.ok(Number.isInteger(hook.timeout));
    assert.ok(!JSON.stringify(hook).includes("${prompt}"), "the prompt text must never be sent");
  });

  it("matches the Claude Code plugin hook except for the server reference", () => {
    const plugin = readJson("packages/claude-code/hooks/hooks.json") as {
      hooks: { UserPromptSubmit: Array<{ hooks: Array<Record<string, unknown>> }> };
    };
    const pluginHook = plugin.hooks.UserPromptSubmit[0]?.hooks[0];
    assert.ok(pluginHook, "the Claude Code plugin declares a UserPromptSubmit hook");
    assert.deepEqual(settings.hooks.UserPromptSubmit[0].hooks[0], { ...pluginHook, server: "zotero_bridge" });
  });

  it("references the given server name", () => {
    const custom = JSON.parse(claudeCodeHookSettingsJson("my-zotero"));
    assert.equal(custom.hooks.UserPromptSubmit[0].hooks[0].server, "my-zotero");
  });
});

describe("resolveBridgeStatus", () => {
  const healthy: BridgeStatusInputs = { error: null, port: 23119, loopbackVerified: true };

  it("is running only when every precondition holds", () => {
    assert.equal(resolveBridgeStatus(healthy), "running");
  });

  it("applies precedence: error, server-not-running, loopback-unverified", () => {
    const cases: Array<[Partial<BridgeStatusInputs>, string]> = [
      [{ error: "boom", port: null, loopbackVerified: false }, "error"],
      [{ port: null, loopbackVerified: false }, "server-not-running"],
      [{ loopbackVerified: false }, "loopback-unverified"],
    ];
    for (const [override, expected] of cases) {
      assert.equal(resolveBridgeStatus({ ...healthy, ...override }), expected, JSON.stringify(override));
    }
  });
});
