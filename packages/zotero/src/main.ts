/**
 * Plugin runtime, built as content/bridge.js and loaded by bootstrap.js into the bootstrap sandbox.
 *
 * Bundle contract: esbuild builds this file as a strict IIFE with no ESM exports (the build rejects exports);
 * bootstrap.js evaluates it with `loadSubScriptWithOptions(url, { target: globalThis, ignoreCache: true,
 * allowUnsafeURL: true })`, and the last statement below adds the only global, a plain (deletable) property
 * `globalThis.ZoteroAIBridgeMain = { startup(data), shutdown(reason) }`. While running, the runtime also
 * publishes `Zotero.ZoteroAIBridge` (BridgePaneApi) for the preferences pane and removes it on shutdown.
 */
import toolContract from "../../../shared/contracts/tools.json";
import contextPolicy from "../../../shared/instructions/context-policy.md";
import { extractSection } from "../../../shared/instructions/sections.js";
import { BRIDGE_TITLE, ENDPOINT_PATHS } from "../../../shared/types/bridge.js";
import type { ToolContractFile } from "../../../shared/types/mcp.js";
import type { ToolName } from "../../../shared/types/tool-names.js";
import {
  patchResponseCodes,
  readServerPort,
  registerEndpoints,
  verifyLoopbackBinding,
  type EndpointRegistration,
} from "./server/endpoint.js";
import {
  resolveBridgeStatus,
  type BridgePaneApi,
  type BridgeState,
  type BridgeStatusInputs,
} from "./settings/client-config.js";
import { isBridgeEnabled, observeBridgeEnabled } from "./settings/preferences.js";
import { attachmentHandlers } from "./tools/attachments.js";
import { collectionHandlers } from "./tools/collections.js";
import { contentHandlers } from "./tools/content.js";
import { contextHandlers } from "./tools/context.js";
import { itemHandlers } from "./tools/items.js";
import { libraryHandlers } from "./tools/libraries.js";
import { buildRegistry } from "./tools/registry.js";
import { schemaHandlers } from "./tools/schema.js";
import { createStatusHandlers } from "./tools/status.js";
import type { ToolHandler, ToolRegistry } from "./tools/types.js";
import { ensureItemsLoaded, listNonFeedLibraries } from "./zotero/library.js";
import { startResultCaching } from "./zotero/result-caches.js";

const LOG_PREFIX = "[Zotero AI Bridge]";
/** Let Zotero finish opening its window before warming item caches, then load libraries one at a time. */
const PREWARM_START_DELAY_MS = 3000;
const PREWARM_GAP_MS = 500;

interface ServingConfig {
  registry: ToolRegistry;
  instructions: string;
}

class BridgeRuntime {
  private stopped = false;
  private serving: ServingConfig | null = null;
  private error: string | null = null;
  private loopbackVerified = false;
  private registration: EndpointRegistration | null = null;
  private paneID: string | null = null;
  private restoreResponseCodes: (() => void) | null = null;
  private stopObservingPref: (() => void) | null = null;
  private stopResultCaching: (() => void) | null = null;
  private readonly listeners = new Set<(state: BridgeState) => void>();
  /** Pending sleeps, so shutdown can cancel the timer and release the waiting loop. */
  private readonly sleeps = new Map<ReturnType<typeof setTimeout>, () => void>();
  private readonly api: BridgePaneApi = {
    getState: () => this.getState(),
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    },
  };

  constructor(private readonly data: ZoteroAIBridgeStartupData) {}

  async start(): Promise<void> {
    if (this.stopped) return;
    this.restoreResponseCodes = patchResponseCodes();
    try {
      this.serving = {
        registry: buildRegistry(toolContract as ToolContractFile, this.handlers()),
        instructions: extractSection(contextPolicy, "server-instructions"),
      };
    } catch (e) {
      this.error = `Tool setup failed: ${asError(e).message}`;
      Zotero.logError(asError(e));
    }
    this.loopbackVerified = verifyLoopbackBinding();
    if (!this.loopbackVerified) {
      Zotero.warn(
        new Error(`${LOG_PREFIX} could not verify that Zotero's HTTP server binds 127.0.0.1 only; endpoints stay off`),
      );
    }
    Zotero.ZoteroAIBridge = this.api;
    // Result caches are enabled only together with the change observer that clears them.
    this.stopResultCaching = startResultCaching();
    this.stopObservingPref = observeBridgeEnabled(() => this.apply());
    this.apply();
    await this.registerPane();
    this.prewarm().catch((e: unknown) => {
      Zotero.debug(`${LOG_PREFIX} item pre-warm stopped: ${errorName(e)}`);
    });
  }

  /** Same cleanup for every shutdown reason; each step runs even if an earlier one throws. */
  stop(): void {
    this.stopped = true;
    this.cleanup(() => {
      const stopObservingPref = this.stopObservingPref;
      this.stopObservingPref = null;
      stopObservingPref?.();
    });
    this.cleanup(() => this.unregisterEndpoints());
    this.cleanup(() => {
      const stopResultCaching = this.stopResultCaching;
      this.stopResultCaching = null;
      stopResultCaching?.();
    });
    this.cleanup(() => {
      for (const [timer, release] of this.sleeps) {
        clearTimeout(timer);
        release();
      }
      this.sleeps.clear();
    });
    this.cleanup(() => {
      const paneID = this.paneID;
      this.paneID = null;
      if (paneID !== null) Zotero.PreferencePanes.unregister(paneID);
    });
    this.cleanup(() => {
      if (Zotero.ZoteroAIBridge === this.api) delete Zotero.ZoteroAIBridge;
      this.listeners.clear();
    });
    this.cleanup(() => {
      const restoreResponseCodes = this.restoreResponseCodes;
      this.restoreResponseCodes = null;
      restoreResponseCodes?.();
    });
  }

  private cleanup(step: () => void): void {
    try {
      step();
    } catch (e) {
      Zotero.logError(asError(e));
    }
  }

  private handlers(): Record<ToolName, ToolHandler> {
    return {
      ...createStatusHandlers(() => this.getState()),
      ...contextHandlers,
      ...libraryHandlers,
      ...collectionHandlers,
      ...itemHandlers,
      ...contentHandlers,
      ...attachmentHandlers,
      ...schemaHandlers,
    };
  }

  private statusInputs(): BridgeStatusInputs {
    return {
      enabled: isBridgeEnabled(),
      error: this.error,
      port: readServerPort(),
      loopbackVerified: this.loopbackVerified,
    };
  }

  private getState(): BridgeState {
    const inputs = this.statusInputs();
    return {
      status: resolveBridgeStatus(inputs),
      version: this.data.version,
      enabled: inputs.enabled,
      port: inputs.port,
      loopbackVerified: this.loopbackVerified,
      registeredPaths: this.registration ? [...this.registration.paths] : [],
      error: this.error,
    };
  }

  /** Bring endpoint registration in line with the current status (called at start and on every pref change). */
  private apply(): void {
    if (this.stopped) return;
    const inputs = this.statusInputs();
    const shouldServe = resolveBridgeStatus(inputs) === "running";
    if (shouldServe && !this.registration && this.serving && inputs.port !== null) {
      this.registration = registerEndpoints({
        registry: this.serving.registry,
        instructions: this.serving.instructions,
        serverVersion: this.data.version,
        port: inputs.port,
      });
      Zotero.debug(`${LOG_PREFIX} serving ${ENDPOINT_PATHS.join(" and ")} on 127.0.0.1:${inputs.port}`);
    } else if (!shouldServe && this.registration) {
      this.unregisterEndpoints();
    }
    this.notify();
  }

  private unregisterEndpoints(): void {
    const registration = this.registration;
    if (!registration) return;
    this.registration = null;
    registration.unregister();
    Zotero.debug(`${LOG_PREFIX} endpoints unregistered`);
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const state = this.getState();
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch {
        // A closed preferences window leaves a dead wrapper behind; forget it.
        this.listeners.delete(listener);
      }
    }
  }

  private async registerPane(): Promise<void> {
    const root = this.data.rootURI;
    try {
      const id = await Zotero.PreferencePanes.register({
        pluginID: this.data.id,
        src: `${root}content/preferences.xhtml`,
        scripts: [`${root}content/preferences.js`],
        label: BRIDGE_TITLE,
        image: `${root}content/icons/icon.svg`,
      });
      // Shutdown may have run while registration was pending; Zotero's own cleanup has already passed by then.
      if (this.stopped) Zotero.PreferencePanes.unregister(id);
      else this.paneID = id;
    } catch (e) {
      Zotero.logError(asError(e));
    }
  }

  /**
   * Zotero 11 loads item data lazily per library; loading it in the background (read-only) keeps the first
   * tool call or hook from paying for a cold load. Sequential and best effort; only while the bridge serves.
   */
  private async prewarm(): Promise<void> {
    await Zotero.uiReadyPromise;
    await this.sleep(PREWARM_START_DELAY_MS);
    for (const library of listNonFeedLibraries()) {
      if (this.stopped || !this.registration) return;
      try {
        await ensureItemsLoaded(library);
      } catch {
        // Tools load on demand anyway; a failed warm-up only costs latency later.
      }
      await this.sleep(PREWARM_GAP_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.stopped) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.sleeps.delete(timer);
        resolve();
      }, ms);
      this.sleeps.set(timer, resolve);
    });
  }
}

/**
 * Errors thrown by Zotero code come from another realm and fail `instanceof Error` in this sandbox, so test
 * the shape instead. Zotero.logError reads .message/.fileName/.lineNumber.
 */
function asError(e: unknown): Error {
  return typeof e === "object" && e !== null ? (e as Error) : new Error(String(e));
}

/** Exception type only, for debug lines that must not carry content. */
function errorName(e: unknown): string {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  return typeof name === "string" && /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : typeof e;
}

/**
 * One runtime per evaluation of this bundle. bootstrap.js re-evaluates the bundle on every startup (a fresh
 * closure), so an earlier runtime is out of reach here: bootstrap.js shuts the previous ZoteroAIBridgeMain down
 * before loading the bundle again.
 */
let runtime: BridgeRuntime | null = null;

async function startup(data: ZoteroAIBridgeStartupData): Promise<void> {
  // Assigned before awaiting so a shutdown that arrives meanwhile stops this instance.
  const current = new BridgeRuntime(data);
  runtime = current;
  await Zotero.initializationPromise;
  await current.start();
}

function shutdown(reason: number): void {
  Zotero.debug(`${LOG_PREFIX} shutting down (reason ${reason})`);
  runtime?.stop();
  runtime = null;
}

globalThis.ZoteroAIBridgeMain = { startup, shutdown };
