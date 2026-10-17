/**
 * Pure helpers shared by the Zotero runtime and the preferences pane: the bridge state shown to the user and
 * status resolution. No Zotero globals (unit-tested in Node, bundled into
 * content/preferences.js).
 */

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
 * Published as Zotero.ZoteroReadingBridge while the plugin runs (see src/main.ts). The state is settled before the
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
