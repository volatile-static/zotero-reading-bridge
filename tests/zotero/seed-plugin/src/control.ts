/**
 * Process-level controls for the harness: environment report, the bridge's enable pref, add-on
 * disable/enable through AddonManager, and a clean quit.
 */
import {
  SEED_ADDON_ID,
  SEED_WRITABLE_PREFS,
  type AddonRequest,
  type AddonResult,
  type PluginState,
  type PrefRequest,
  type PrefResult,
  type SeedStateResult,
  type TagRequest,
  type TagResult,
} from "../../seed-api.js";
import { listWindows } from "./ui.js";
import { waitFor } from "./util.js";

let uiReady = false;

export function markUiReady(): void {
  uiReady = true;
}

function addonManager(): any {
  return ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager;
}

function pluginState(addon: any): PluginState {
  return {
    id: addon.id,
    version: addon.version,
    isActive: !!addon.isActive,
    userDisabled: !!addon.userDisabled,
    appDisabled: !!addon.appDisabled,
  };
}

/** Bridge and seed paths currently registered on Zotero's HTTP server. */
export function registeredEndpoints(): string[] {
  return Object.keys(Zotero.Server.Endpoints)
    .filter((path) => /^\/(bridge|codex|zab-test)\//.test(path))
    .sort();
}

function serverPort(): number | null {
  try {
    // Getter missing from zotero-types; throws while the server is not listening.
    return (Zotero.Server as any).port as number;
  } catch {
    return null;
  }
}

export async function seedState(): Promise<SeedStateResult> {
  const addons = (await addonManager().getAllAddons()) as any[];
  return {
    ok: true,
    zoteroVersion: Zotero.version,
    platformVersion: String((Zotero as any).platformVersion),
    locale: String(Zotero.locale),
    dataDir: Zotero.DataDirectory.dir,
    profileDir: PathUtils.profileDir,
    port: serverPort(),
    uiReady,
    plugins: addons.filter((addon) => addon.type === "extension").map(pluginState),
    libraries: (Zotero.Libraries.getAll() as Zotero.Library[]).map((lib: any) => ({
      libraryID: lib.libraryID,
      type: lib.libraryType,
      name: lib.name,
      groupID: lib.libraryType === "group" ? lib.groupID : null,
    })),
    windows: listWindows(),
    endpoints: registeredEndpoints(),
  };
}

export async function setPref(request: PrefRequest): Promise<PrefResult> {
  if (!(SEED_WRITABLE_PREFS as readonly string[]).includes(request.name)) {
    throw new Error(`Pref ${request.name} is not writable through the seed plugin`);
  }
  if (request.value === null) Zotero.Prefs.clear(request.name, true);
  else Zotero.Prefs.set(request.name, request.value, true);
  return { ok: true, name: request.name, value: Zotero.Prefs.get(request.name, true) ?? null, endpoints: registeredEndpoints() };
}

/** Add or remove a tag on one item and save it, exactly like a user edit (notifier events included). */
export async function setTag(request: TagRequest): Promise<TagResult> {
  const item = Zotero.Items.getByLibraryAndKey(request.libraryID, request.key) as Zotero.Item | false;
  if (!item) throw new Error(`Item ${request.libraryID}/${request.key} not found`);
  if (request.action === "add") item.addTag(request.tag);
  else item.removeTag(request.tag);
  await item.saveTx();
  return { ok: true, tags: item.getTags().map((entry) => entry.tag) };
}

export async function controlAddon(request: AddonRequest): Promise<AddonResult> {
  const started = Date.now();
  if (request.id === SEED_ADDON_ID && request.action !== "status") {
    throw new Error("The seed plugin cannot disable itself (it is the harness's control channel)");
  }
  const manager = addonManager();
  const addon = await manager.getAddonByID(request.id);
  if (!addon) return { ok: true, addon: null, endpoints: registeredEndpoints(), ms: Date.now() - started };
  if (request.action === "disable") await addon.disable();
  if (request.action === "enable") await addon.enable();
  if (request.action !== "status") {
    const wantActive = request.action === "enable";
    await waitFor(`add-on ${request.id} ${request.action}d`, async () => {
      const current = await manager.getAddonByID(request.id);
      return current && !!current.isActive === wantActive ? true : null;
    });
  }
  const current = await manager.getAddonByID(request.id);
  return { ok: true, addon: current ? pluginState(current) : null, endpoints: registeredEndpoints(), ms: Date.now() - started };
}

/** Quit after the HTTP response has been written, so the harness sees the acknowledgement. */
export function scheduleQuit(): void {
  setTimeout(() => Zotero.Utilities.Internal.quit(), 250);
}
