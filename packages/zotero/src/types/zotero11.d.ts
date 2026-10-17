/**
 * Ambient declarations for Zotero 11 APIs the plugin uses that zotero-types 4.1.3 lacks, plus the bundle
 * contracts between bootstrap.js, content/bridge.js and the preferences pane.
 * Every Zotero member here was checked against the Zotero 11.0-beta.1 sources (file named per member).
 * This file stays a global script (no top-level import/export) so the wildcard module declaration works;
 * other modules may append clearly separated sections.
 */

/** Markdown imported as text (esbuild `text` loader), e.g. shared/instructions/context-policy.md. */
declare module "*.md" {
  const text: string;
  export default text;
}

declare namespace _ZoteroTypes {
  interface Server {
    /**
     * Port the HTTP server actually bound. Throws Error("Server not initialized") when the server is disabled
     * or failed to bind (xpcom/server/server.js, `Object.defineProperty(this, 'port', ...)`).
     */
    readonly port: number;
    /** Starts the server; called once from Zotero.init (xpcom/server/server.js `this.init`). */
    init(port?: number): Promise<void>;
  }
}

declare namespace Zotero {
  namespace Debug {
    /** True while debug output is logged, viewed or stored (xpcom/debug.js `this.enabled`). */
    const enabled: boolean;
  }

  /** Published by Zotero Reading Bridge while it runs, for its preferences pane (src/main.ts). */
  let ZoteroReadingBridge: import("../settings/client-config.js").BridgePaneApi | undefined;
}

// ---- Zotero Reading Bridge bundle contract (owner: runtime) ----
// bootstrap.js evaluates content/bridge.js with `target: globalThis` (the bootstrap sandbox); the bundle assigns
// this global, which bootstrap.js reads after loading and deletes on shutdown.

interface ZoteroReadingBridgeStartupData {
  id: string;
  version: string;
  rootURI: string;
}

interface ZoteroReadingBridgeMainApi {
  startup(data: ZoteroReadingBridgeStartupData): Promise<void>;
  /** `reason` is the bootstrap reason constant (APP_SHUTDOWN, ADDON_DISABLE, ...); used for logging only. */
  shutdown(reason: number): void;
}

declare var ZoteroReadingBridgeMain: ZoteroReadingBridgeMainApi | undefined;
