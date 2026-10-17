/**
 * get_status: what a client should call first when other Zotero tools fail. Every section is computed
 * defensively so the tool itself cannot fail on an unloaded library or a missing Zotero property.
 */
import { BRIDGE_NAME, BRIDGE_TITLE, endpointUrl } from "../../../../shared/types/bridge.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "../../../../shared/types/mcp.js";
import type { LibraryRef } from "../../../../shared/types/tools.js";
import type { BridgeState, BridgeStatusKind } from "../settings/client-config.js";
import { itemsLoaded, listNonFeedLibraries } from "../zotero/library.js";
import { libraryRef, safe } from "../zotero/refs.js";
import { json, type ToolCallContext, type ToolHandler } from "./types.js";

export interface StatusResult {
  bridge: {
    name: string;
    title: string;
    version: string;
    status: BridgeStatusKind;
    /** Network downloads write temporary files, but never modify the library. */
    readOnly: false;
    libraryReadOnly: true;
    temporaryDownloads: true;
    endpoints: Array<{ path: string; url: string | null }>;
    /** Path this request arrived on (/bridge/mcp). */
    requestPath: string;
    /** Protocol version of this request (negotiated or from the MCP-Protocol-Version header). */
    protocolVersion: string;
    protocolVersions: string[];
    loopbackVerified: boolean;
  };
  zotero: {
    version: string;
    platform: string;
    locale: string | null;
    port: number | null;
    /** When true, Zotero's own debug log records request headers and bodies. */
    debugOutputLogging: boolean;
  };
  libraries: Array<LibraryRef & { itemsLoaded: boolean }>;
  /** ISO-8601 UTC time of this response. */
  time: string;
}

/** The handler reads live runtime state through `getState` (owned by src/main.ts). */
export function createStatusHandlers(getState: () => BridgeState): { get_status: ToolHandler } {
  return {
    get_status: async (_args, ctx) => json(buildStatus(getState(), ctx)),
  };
}

function buildStatus(state: BridgeState, ctx: ToolCallContext): StatusResult {
  return {
    bridge: {
      name: BRIDGE_NAME,
      title: BRIDGE_TITLE,
      version: state.version,
      status: state.status,
      readOnly: false,
      libraryReadOnly: true,
      temporaryDownloads: true,
      endpoints: state.registeredPaths.map((path) => ({
        path,
        url: state.port === null ? null : endpointUrl(state.port, path),
      })),
      requestPath: ctx.endpointPath,
      protocolVersion: ctx.protocolVersion,
      protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      loopbackVerified: state.loopbackVerified,
    },
    zotero: {
      version: safe(() => Zotero.version, ""),
      platform: platformName(),
      locale: safe<string | null>(() => Zotero.locale || null, null),
      port: state.port,
      debugOutputLogging: safe(() => Boolean(Zotero.Debug.enabled), false),
    },
    libraries: safe(
      () => listNonFeedLibraries().map((lib) => ({ ...libraryRef(lib), itemsLoaded: itemsLoaded(lib) })),
      [],
    ),
    time: new Date().toISOString(),
  };
}

/** Zotero.platform is declared by zotero-types but never assigned in Zotero 11; use the OS flags instead. */
function platformName(): string {
  if (Zotero.isWin) return "windows";
  if (Zotero.isMac) return "macos";
  if (Zotero.isLinux) return "linux";
  return safe(() => Services.appinfo.OS, "unknown");
}
