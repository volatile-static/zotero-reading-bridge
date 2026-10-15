/**
 * Drives Zotero's preferences window for a plugin pane and reports what a user would see: whether the pane
 * loaded, the Fluent translation of each localized element, the pref-bound checkbox and the values the pane
 * script filled in. Also formats plugin FTL messages per locale through a fresh Localization, which shows
 * whether Zotero's plugin locale registration (plugins.js registerLocales) found locale/<lang>/ in the XPI.
 */
import type { PaneElementState, PaneState, PrefsPaneRequest, PrefsPaneResult } from "../../seed-api.js";
import { errorMessage, waitFor } from "./util.js";

const PREF_WINDOW_TYPE = "zotero:pref";
/** plugins.js PLUGIN_L10N_SOURCE_NAME: every plugin's FTL is merged into this one L10nRegistry source. */
const PLUGIN_L10N_SOURCE = "zotero-plugins";
const PLUGIN_FTL_RESOURCE = "zotero-ai-bridge.ftl";
const PANE_TIMEOUT_MS = 20000;

interface RegisteredPane {
  id: string;
  pluginID: string;
  rawLabel: string;
  image?: string;
}

function prefsWindow(): any | null {
  return (Services.wm.getMostRecentWindow(PREF_WINDOW_TYPE) as any) ?? null;
}

function registeredPane(pluginID: string): RegisteredPane | null {
  const panes = ((Zotero as any).PreferencePanes?.pluginPanes ?? []) as RegisteredPane[];
  return panes.find((pane) => pane.pluginID === pluginID) ?? null;
}

function elementState(el: Element): PaneElementState {
  return {
    id: el.id || null,
    tag: el.localName,
    l10nId: el.getAttribute("data-l10n-id") ?? "",
    text: (el.textContent ?? "").trim(),
    label: el.getAttribute("label"),
  };
}

function paneState(win: any, paneID: string): PaneState | null {
  const pane = win.Zotero_Preferences?.panes?.get(paneID);
  if (!pane) return null;
  const container = pane.container as Element & { hidden: boolean };
  const byId = (id: string) => container.querySelector(`#${id}`) as any;
  const checkbox = byId("zab-enabled");
  const status = byId("zab-status");
  const buttonsDisabled: Record<string, boolean> = {};
  for (const button of container.querySelectorAll("button[id]")) buttonsDisabled[button.id] = button.hasAttribute("disabled");
  return {
    loaded: !!pane.loaded,
    shown: !container.hidden,
    heading: container.querySelector("h1")?.textContent ?? null,
    elements: [...container.querySelectorAll("[data-l10n-id]")].map(elementState),
    checkbox: checkbox ? { preference: checkbox.getAttribute("preference"), checked: !!checkbox.checked } : null,
    status: status ? { l10nId: status.getAttribute("data-l10n-id"), text: (status.textContent ?? "").trim() } : null,
    address: byId("zab-address")?.value ?? null,
    alias: byId("zab-alias")?.value ?? null,
    buttonsDisabled,
  };
}

async function imageBytes(url: string | undefined): Promise<number | null> {
  if (!url) return null;
  try {
    return (await Zotero.File.getResourceAsync(url)).length;
  } catch {
    return null;
  }
}

async function formatMessages(
  win: any,
  request: PrefsPaneRequest["messages"],
): Promise<Record<string, Record<string, string | null> | null>> {
  const out: Record<string, Record<string, string | null> | null> = {};
  if (!request) return out;
  const available = [...(Services.locale.availableLocales as string[])];
  for (const locale of request.locales) {
    if (!available.includes(locale)) {
      out[locale] = null;
      continue;
    }
    // Only this locale, no fallback chain: a value proves that locale's FTL was registered.
    const localization = new win.Localization([PLUGIN_FTL_RESOURCE], false, undefined, [locale]);
    const values = (await localization.formatValues(request.ids.map((id) => ({ id })))) as Array<string | null | undefined>;
    out[locale] = Object.fromEntries(request.ids.map((id, i) => [id, values[i] ?? null]));
  }
  return out;
}

async function openPane(paneID: string): Promise<any> {
  Zotero.Utilities.Internal.openPreferences(paneID);
  return waitFor(
    "plugin preferences pane",
    () => {
      const win = prefsWindow();
      const state = win ? paneState(win, paneID) : null;
      // The status line is filled by the pane script and translated asynchronously by Fluent.
      return state?.loaded && state.shown && state.status?.text ? win : null;
    },
    PANE_TIMEOUT_MS,
  );
}

export async function prefsPane(request: PrefsPaneRequest): Promise<PrefsPaneResult> {
  const started = Date.now();
  await Zotero.uiReadyPromise;
  const registered = registeredPane(request.pluginID);
  let win = prefsWindow();
  if (request.action === "open") {
    if (!registered) throw new Error(`Plugin ${request.pluginID} registered no preferences pane`);
    win = await openPane(registered.id);
  } else if (request.action === "close" && win) {
    win.close();
    await waitFor("preferences window closed", () => (prefsWindow() ? null : true), PANE_TIMEOUT_MS);
    win = null;
  }
  const mainWindow = Zotero.getMainWindow() as any;
  let messages: PrefsPaneResult["messages"] = {};
  try {
    messages = await formatMessages(mainWindow, request.messages);
  } catch (error) {
    throw new Error(`Formatting plugin Fluent messages failed: ${errorMessage(error)}`);
  }
  return {
    ok: true,
    registered: registered
      ? { paneID: registered.id, label: registered.rawLabel, image: registered.image ?? null, imageBytes: await imageBytes(registered.image) }
      : null,
    windowOpen: !!win,
    pane: win && registered ? paneState(win, registered.id) : null,
    l10nSourceRegistered: !!mainWindow.L10nRegistry?.getInstance().hasSource(PLUGIN_L10N_SOURCE),
    availableLocales: [...(Services.locale.availableLocales as string[])],
    messages,
    ms: Date.now() - started,
  };
}
