/**
 * Contract between client hooks (Codex / Claude Code `mcp_tool` UserPromptSubmit hooks)
 * and the capture_prompt_context tool.
 *
 * Both clients concatenate the tool's text content and parse it like command-hook stdout:
 *  - exactly `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}`
 *    with NO other keys (Codex uses deny_unknown_fields) is applied as additional context;
 *  - isError: true is a non-blocking failure that injects nothing, so it is never used for
 *    "nothing selected" or "Zotero data unavailable": those are reported inside additionalContext.
 */

/** Arguments sent by the hooks. Only client/session/turn identifiers; never the prompt or transcript. */
export interface CapturePromptContextArgs {
  client: string;
  session_id?: string;
  /** Codex `${turn_id}`. */
  turn_id?: string;
  /** Claude Code `${prompt_id}` (empty string before the first prompt; treated as absent). */
  prompt_id?: string;
}

export interface UserPromptSubmitHookOutput {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit";
    additionalContext: string;
  };
}

/** Server names the client plugins use for the bundled MCP server. Hooks must reference these. */
export const CLIENT_SERVER_NAMES = {
  /** Codex: bare key from the plugin's .mcp.json (flat namespace shared with config.toml). */
  codex: "zotero_bridge",
  /** Claude Code: key inside the plugin's .mcp.json ... */
  claudeCode: "zotero",
  /** ... which hooks must reference as plugin:<plugin-name>:<server-key>. */
  claudeCodeHookServer: "plugin:zotero-reading-bridge:zotero",
  /**
   * Claude Code manual registration (`claude mcp add`) and its settings.json hook. Same distinctive name as Codex:
   * a bare "zotero" is often taken by another Zotero MCP server, and a same-name server at a higher-precedence
   * scope (local > project > user) would shadow the bridge and receive the hook calls.
   */
  claudeCodeManual: "zotero_bridge",
  /** Claude Desktop manual stdio registration (claude_desktop_config.json) of the relay; no hooks there. */
  claudeDesktopManual: "zotero_bridge",
} as const;

export const PLUGIN_NAME = "zotero-reading-bridge";
