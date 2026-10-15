/**
 * Bootstrap entry of the TEST-ONLY seed plugin. Bundled by tests/zotero/build-seed.ts as an IIFE; the
 * lifecycle functions are published on the sandbox global, where Zotero's plugin loader looks them up.
 */
import { markUiReady } from "./control.js";
import { registerSeedEndpoints, unregisterSeedEndpoints } from "./endpoints.js";

interface LifecycleData {
  id: string;
  version: string;
  rootURI: string;
}

async function startup(_data: LifecycleData, _reason: number): Promise<void> {
  await Zotero.initializationPromise;
  registerSeedEndpoints();
  void Zotero.uiReadyPromise.then(markUiReady);
}

function shutdown(_data: LifecycleData, _reason: number): void {
  unregisterSeedEndpoints();
}

// Zotero warns when a lifecycle method is missing; the seed plugin has nothing to do on (un)install.
function install(): void {}
function uninstall(): void {}

Object.assign(globalThis, { startup, shutdown, install, uninstall });
