/**
 * Bridge-wide constants shared by the Zotero plugin, client config generation, build scripts and tests.
 */

export const BRIDGE_NAME = "zotero-ai-bridge";
export const BRIDGE_TITLE = "Zotero AI Bridge";

/** Zotero add-on id (manifest applications.zotero.id). */
export const ZOTERO_ADDON_ID = "zotero-ai-bridge@zotero-ai-bridge.local";

/** Preference branch for the plugin's own prefs. */
export const PREF_BRANCH = "extensions.zotero-ai-bridge.";
export const PREF_ENABLED = `${PREF_BRANCH}enabled`;

/** Primary endpoint path and its alias; both share one handler and one access policy. */
export const ENDPOINT_PATH = "/bridge/mcp";
export const ENDPOINT_ALIAS_PATH = "/codex/mcp";
export const ENDPOINT_PATHS = [ENDPOINT_PATH, ENDPOINT_ALIAS_PATH] as const;

/** Zotero's default built-in HTTP server port (extensions.zotero.httpServer.port). */
export const DEFAULT_ZOTERO_PORT = 23119;
/** Zotero binds IPv4 loopback only; clients must use this host. */
export const LOOPBACK_HOST = "127.0.0.1";

export function endpointUrl(port: number = DEFAULT_ZOTERO_PORT, path: string = ENDPOINT_PATH): string {
  return `http://${LOOPBACK_HOST}:${port}${path}`;
}

/** Pagination defaults applied by every list tool. */
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;
