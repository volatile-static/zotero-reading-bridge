/**
 * Preferences pane script, built as content/preferences.js (esbuild IIFE).
 *
 * Zotero evaluates it in a per-pane sandbox whose prototype is the preferences window, BEFORE inserting
 * preferences.xhtml, then dispatches a non-bubbling `load` event on each top-level element of the pane; a
 * capturing listener on the document receives it. Every listener is attached here because Zotero plans to
 * enforce a chrome CSP that blocks inline handlers. The enable checkbox is bound by Zotero itself through its
 * `preference` attribute.
 */
import { ENDPOINT_ALIAS_PATH, ENDPOINT_PATH, endpointUrl } from "../../../shared/types/bridge.js";
import { CLIENT_SERVER_NAMES } from "../../../shared/types/hook.js";
import {
  claudeCodeAddCommand,
  claudeCodeHookSettingsJson,
  codexConfigToml,
  type BridgePaneApi,
  type BridgeState,
  type BridgeStatusKind,
} from "../src/settings/client-config.js";

const ROOT_ID = "zab-pane";
const COPIED_VISIBLE_MS = 2500;

const STATUS_MESSAGE_IDS: Record<BridgeStatusKind, string> = {
  running: "zotero-ai-bridge-pref-status-running",
  disabled: "zotero-ai-bridge-pref-status-disabled",
  "server-not-running": "zotero-ai-bridge-pref-status-server-not-running",
  "loopback-unverified": "zotero-ai-bridge-pref-status-loopback-unverified",
  error: "zotero-ai-bridge-pref-status-error",
};

/** Copy buttons that need a known port; the hook settings do not depend on the address. */
const ADDRESS_BUTTON_IDS = ["zab-copy-address", "zab-copy-codex", "zab-copy-claude"] as const;

function bridgeApi(): BridgePaneApi | undefined {
  // Published on the shared Zotero object by the running plugin (src/main.ts) and removed on shutdown.
  // The pane's tsconfig does not see the sandbox-side declaration, hence the narrow cast.
  return (Zotero as unknown as { ZoteroAIBridge?: BridgePaneApi }).ZoteroAIBridge;
}

class BridgePane {
  private state: BridgeState | undefined;
  private unsubscribe: (() => void) | undefined;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly root: Element) {}

  init(): void {
    this.onCommand("zab-copy-address", () => this.address(ENDPOINT_PATH));
    this.onCommand("zab-copy-codex", () => this.withAddress(codexConfigToml));
    this.onCommand("zab-copy-claude", () => this.withAddress(claudeCodeAddCommand));
    this.onCommand("zab-copy-claude-hook", () => claudeCodeHookSettingsJson(CLIENT_SERVER_NAMES.claudeCodeManual));
    // Zotero fires `showing` each time the pane is displayed and `unload` when the window closes.
    this.root.addEventListener("showing", () => this.render(bridgeApi()?.getState()));
    this.root.addEventListener("unload", () => this.destroy(), { once: true });
    const api = bridgeApi();
    this.unsubscribe = api?.subscribe((state) => this.render(state));
    this.render(api?.getState());
  }

  private destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.copiedTimer);
  }

  private element<T extends Element = Element>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Zotero AI Bridge preferences: missing #${id}`);
    return element;
  }

  private onCommand(id: string, text: () => string | null): void {
    this.element(id).addEventListener("command", () => {
      const value = text();
      if (value === null) return;
      Zotero.Utilities.Internal.copyTextToClipboard(value);
      this.showCopied();
    });
  }

  private address(path: string): string | null {
    const port = this.state?.port ?? null;
    return port === null ? null : endpointUrl(port, path);
  }

  private withAddress(render: (url: string) => string): string | null {
    const url = this.address(ENDPOINT_PATH);
    return url === null ? null : render(url);
  }

  private showCopied(): void {
    const copied = this.element<HTMLElement>("zab-copied");
    copied.hidden = false;
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      copied.hidden = true;
    }, COPIED_VISIBLE_MS);
  }

  private render(state: BridgeState | undefined): void {
    this.state = state;
    const status = this.element("zab-status");
    if (state) {
      // Pass the port as a string: Fluent would format a number with digit grouping ("23,119").
      document.l10n?.setAttributes(status, STATUS_MESSAGE_IDS[state.status], {
        port: state.port === null ? "" : String(state.port),
        error: state.error ?? "",
      });
    } else {
      document.l10n?.setAttributes(status, "zotero-ai-bridge-pref-status-unavailable");
    }
    this.element<HTMLInputElement>("zab-address").value = this.address(ENDPOINT_PATH) ?? "";
    this.element<HTMLInputElement>("zab-alias").value = this.address(ENDPOINT_ALIAS_PATH) ?? "";
    const hasAddress = state?.port !== undefined && state.port !== null;
    for (const id of ADDRESS_BUTTON_IDS) {
      // XUL boolean attributes count by presence alone in Zotero 11, so toggle rather than set "false".
      this.element(id).toggleAttribute("disabled", !hasAddress);
    }
  }
}

document.addEventListener(
  "load",
  (event) => {
    // Compare ids rather than using instanceof: the sandbox's Element is the window's, reached through a wrapper.
    const target = event.target as Element | null;
    if (target?.id === ROOT_ID) new BridgePane(target).init();
  },
  true,
);
