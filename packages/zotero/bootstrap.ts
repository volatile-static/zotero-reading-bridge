/**
 * Zotero bootstrap entry, built as bootstrap.js at the XPI root (strict esbuild IIFE, no ESM exports).
 *
 * Global contract (xpcom/plugins.js): Zotero evaluates this file in a per-plugin system-principal Cu.Sandbox
 * (`_loadScope`), looks each lifecycle method up as `scope[method]` and calls it as
 * `method.call(scope, { id, version, rootURI }, reason)`, awaiting a returned promise (`_callMethod`). The
 * IIFE would hide function declarations, so they are assigned onto the sandbox global explicitly. startup()
 * evaluates content/bridge.js (src/main.ts) into this same sandbox; that bundle adds exactly one configurable
 * global, `ZoteroAIBridgeMain = { startup(data), shutdown(reason) }`, which shutdown() deletes again. A startup
 * that finds the global still set (no shutdown in between) shuts that runtime down before loading a new one.
 */
export {};

interface BootstrapData {
  id: string;
  version: string;
  rootURI: string;
}

/** Load the runtime bundle into this sandbox; it publishes `globalThis.ZoteroAIBridgeMain`. */
function loadMain(rootURI: string): ZoteroAIBridgeMainApi {
  Services.scriptloader.loadSubScriptWithOptions(`${rootURI}content/bridge.js`, {
    target: globalThis,
    // A new plugin version must not run a cached copy of the previous bundle.
    ignoreCache: true,
    // Plugins load from jar:file: URIs, which the script loader otherwise refuses (Mozilla bug 1974213).
    allowUnsafeURL: true,
  });
  const main = globalThis.ZoteroAIBridgeMain;
  if (!main) throw new Error("content/bridge.js did not define ZoteroAIBridgeMain");
  return main;
}

async function startup({ id, version, rootURI }: BootstrapData, reason: number): Promise<void> {
  // Zotero can call startup again without a shutdown in between (plugins.js onOperationCancelled after an
  // uninstall + reinstall in one session). loadMain() evaluates a fresh bundle whose runtime cannot see the old
  // one, so stop the previous runtime here, or its endpoints (kept whenever the new runtime does not serve),
  // Notifier observer, response-code patch and preferences pane would outlive every later disable.
  const previous = globalThis.ZoteroAIBridgeMain;
  if (previous) {
    delete globalThis.ZoteroAIBridgeMain;
    try {
      previous.shutdown(reason);
    } catch (e) {
      Zotero.logError(e as Error);
    }
  }
  await loadMain(rootURI).startup({ id, version, rootURI });
}

/** Runs for app shutdown, disable, uninstall and upgrade alike: always release endpoints and observers. */
function shutdown(_data: BootstrapData, reason: number): void {
  const main = globalThis.ZoteroAIBridgeMain;
  // Drop the global first, so even a failing runtime shutdown leaves nothing stale for the next startup.
  delete globalThis.ZoteroAIBridgeMain;
  main?.shutdown(reason);
}

// Defined so Zotero does not warn about missing bootstrap methods; the bridge adds no window UI and keeps no
// install-time state.
function install(): void {}
function uninstall(): void {}
function onMainWindowLoad(): void {}
function onMainWindowUnload(): void {}

Object.assign(globalThis, { install, startup, shutdown, uninstall, onMainWindowLoad, onMainWindowUnload });
