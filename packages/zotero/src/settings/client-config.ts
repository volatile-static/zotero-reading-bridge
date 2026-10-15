/**
 * Pure helpers shared by the Zotero runtime and the preferences pane: the bridge state shown to the user and
 * the client configuration snippets the pane copies. No Zotero globals (unit-tested in Node, bundled into
 * content/preferences.js).
 */
import { CLIENT_SERVER_NAMES } from "../../../../shared/types/hook.js";
import type { ToolName } from "../../../../shared/types/tool-names.js";

/** What the preferences pane and get_status report. */
export type BridgeStatusKind = "running" | "server-not-running" | "loopback-unverified" | "error";

export interface BridgeState {
  status: BridgeStatusKind;
  /** Plugin version from the add-on manifest. */
  version: string;
  /** Port Zotero's HTTP server actually bound; null when the server is not running. */
  port: number | null;
  /** Whether the loopback-only bind of Zotero's HTTP server was verified (endpoints stay off otherwise). */
  loopbackVerified: boolean;
  /** Endpoint paths currently registered with Zotero's server (empty unless running). */
  registeredPaths: string[];
  /** Plugin setup failure, in English; never contains library data. */
  error: string | null;
}

/**
 * Published as Zotero.ZoteroAIBridge while the plugin runs (see src/main.ts). The state is settled before the
 * pane is registered and stays fixed until shutdown, which unregisters the pane (Zotero then reloads open
 * preferences windows), so the pane reads it once.
 */
export interface BridgePaneApi {
  getState(): BridgeState;
}

export interface BridgeStatusInputs {
  error: string | null;
  port: number | null;
  loopbackVerified: boolean;
}

/**
 * Precedence: a broken plugin first, then what Zotero lets us serve.
 * Only "running" means the endpoints should be registered.
 */
export function resolveBridgeStatus(inputs: BridgeStatusInputs): BridgeStatusKind {
  if (inputs.error !== null) return "error";
  if (inputs.port === null) return "server-not-running";
  if (!inputs.loopbackVerified) return "loopback-unverified";
  return "running";
}

/** Timeouts mirror the Codex plugin's .mcp.json so manual and plugin setups behave alike. */
const CODEX_STARTUP_TIMEOUT_SEC = 10;
const CODEX_TOOL_TIMEOUT_SEC = 30;

/** Same hook as both client plugins' hooks/hooks.json: ids only, never the prompt text. */
const HOOK_TOOL: ToolName = "capture_prompt_context";
const HOOK_TIMEOUT_SEC = 5;
const HOOK_STATUS_MESSAGE = "Reading Zotero context";

/** TOML basic string: escape quote, backslash and the control characters TOML forbids unescaped. */
function tomlString(value: string): string {
  const escaped = value.replace(/[\\"\u0000-\u0008\u000a-\u001f\u007f]/g, (char) => {
    if (char === "\\") return "\\\\";
    if (char === '"') return '\\"';
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
  return `"${escaped}"`;
}

/**
 * `config.toml` snippet for Codex users who configure the bridge manually instead of installing the plugin:
 * the server plus the plugin-equivalent prompt hook (same as examples/codex-config.toml.example). The hook
 * references the server by its bare key, which is shared with the plugin, so the two must not be combined.
 */
export function codexConfigToml(url: string): string {
  const server = CLIENT_SERVER_NAMES.codex;
  return [
    "# Zotero AI Bridge: read-only access to the local Zotero library (Zotero must be running).",
    "# Use either this manual configuration or the Codex plugin, not both.",
    `[mcp_servers.${server}]`,
    `url = ${tomlString(url)}`,
    `startup_timeout_sec = ${CODEX_STARTUP_TIMEOUT_SEC}`,
    `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}`,
    "",
    "# Optional: attach the current Zotero selection to each prompt. Codex asks you to trust the hook once (/hooks).",
    "[[hooks.UserPromptSubmit]]",
    "",
    "[[hooks.UserPromptSubmit.hooks]]",
    'type = "mcp_tool"',
    `server = ${tomlString(server)}`,
    `tool = ${tomlString(HOOK_TOOL)}`,
    `timeout = ${HOOK_TIMEOUT_SEC}`,
    `statusMessage = ${tomlString(HOOK_STATUS_MESSAGE)}`,
    "",
    "[hooks.UserPromptSubmit.hooks.input]",
    'client = "codex"',
    'session_id = "${session_id}"',
    'turn_id = "${turn_id}"',
    "",
  ].join("\n");
}

/**
 * Manual Claude Code registration in user scope, so the bridge is available in every project (as the docs
 * recommend); the URL is always a plain http://127.0.0.1:<port>/... address.
 */
export function claudeCodeAddCommand(url: string): string {
  return `claude mcp add --transport http --scope user ${CLIENT_SERVER_NAMES.claudeCodeManual} ${url}`;
}

/**
 * settings.json `hooks` block for a manually registered server named `serverName` (the plugin ships its own
 * hook). Same shape as the plugin hook: only client/session/prompt ids, never the prompt text.
 */
export function claudeCodeHookSettingsJson(serverName: string): string {
  const settings = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "mcp_tool",
              server: serverName,
              tool: HOOK_TOOL,
              input: { client: "claude-code", session_id: "${session_id}", prompt_id: "${prompt_id}" },
              timeout: HOOK_TIMEOUT_SEC,
              statusMessage: HOOK_STATUS_MESSAGE,
            },
          ],
        },
      ],
    },
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}
