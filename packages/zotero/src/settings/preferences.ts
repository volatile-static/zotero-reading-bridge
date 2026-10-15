/**
 * The plugin's own preferences (Zotero sandbox only). Defaults come from prefs.js at the XPI root, which Zotero
 * loads into the default branch before startup. Prefs live under extensions.zotero-ai-bridge.*, outside
 * extensions.zotero.*, so resetting Zotero's branch never touches them.
 */
import { PREF_ENABLED } from "../../../../shared/types/bridge.js";

/** Pass `global` so Zotero.Prefs does not prefix the key with "extensions.zotero.". */
const GLOBAL_KEY = true;

/** Missing pref (e.g. default branch already cleared during shutdown) counts as the default: enabled. */
function toEnabled(value: unknown): boolean {
  return value !== false;
}

export function isBridgeEnabled(): boolean {
  return toEnabled(Zotero.Prefs.get(PREF_ENABLED, GLOBAL_KEY));
}

/** Observe the enable switch; returns the function that removes the observer (Zotero.Prefs holds it otherwise). */
export function observeBridgeEnabled(handler: (enabled: boolean) => void): () => void {
  const symbol = Zotero.Prefs.registerObserver(PREF_ENABLED, (value: unknown) => handler(toEnabled(value)), GLOBAL_KEY);
  return () => Zotero.Prefs.unregisterObserver(symbol);
}
