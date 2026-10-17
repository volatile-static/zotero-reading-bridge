/**
 * Contract between client `mcp_tool` UserPromptSubmit hooks (the Codex plugin ships one; the server also accepts
 * Claude Code's shape, which differs only in its ids)
 * and the capture_prompt_context tool.
 *
 * Hook clients concatenate the tool's text content and parse it like command-hook stdout:
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

/**
 * Server key in the Codex plugin's .mcp.json, which its hook must reference. Codex shares one flat namespace with
 * config.toml, so the name is distinctive: a bare "zotero" is often taken by another Zotero MCP server.
 */
export const CODEX_SERVER_NAME = "zotero_bridge";
