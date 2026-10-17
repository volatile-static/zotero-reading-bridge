/**
 * Bridge-wide constants shared by the Zotero plugin, client config generation, build scripts and tests.
 */

export const BRIDGE_NAME = "zotero-reading-bridge";
export const BRIDGE_TITLE = "Zotero Reading Bridge";

/** Zotero add-on identity for Zotero Reading Bridge. */
export const ZOTERO_ADDON_ID = "zotero-reading-bridge@zotero-reading-bridge.local";
/** Fluent ids share Zotero's localization namespace and use the project prefix. */
export const LOCALIZATION_PREFIX = `${BRIDGE_NAME}-`;

/** The MCP endpoint exposed by the bridge. */
export const ENDPOINT_PATH = "/bridge/mcp";
export const ENDPOINT_PATHS = [ENDPOINT_PATH] as const;

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
