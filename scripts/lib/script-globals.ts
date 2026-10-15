/**
 * Evaluate built classic scripts the way Zotero's subscript loader does (top level of one sandbox global,
 * shared by bootstrap.js and the content/bridge.js it loads with `target: globalThis`) inside a Node vm
 * context, to prove which globals they define. Zotero/Gecko APIs are replaced by inert stubs: the scripts must
 * only *define* things at load time, so the stubs are never meaningfully used.
 */
import vm from "node:vm";

/** Globals Zotero's plugins.js puts on the bootstrap sandbox, plus XPCOM shorthands. */
const STUBBED_GLOBALS = [
  "Zotero",
  "Services",
  "ChromeUtils",
  "Components",
  "Cc",
  "Ci",
  "Cu",
  "Cr",
  "IOUtils",
  "PathUtils",
  "Localization",
  "ChromeWorker",
  "Worker",
  "XMLSerializer",
  "DOMParser",
  "XMLHttpRequest",
  "fetch",
  "Blob",
  "File",
  "FileReader",
  "CSS",
  "crypto",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestIdleCallback",
  "cancelIdleCallback",
] as const;

/** plugins.js REASONS, injected into every bootstrap scope. */
const BOOTSTRAP_REASONS: Readonly<Record<string, number>> = {
  APP_STARTUP: 1,
  APP_SHUTDOWN: 2,
  ADDON_ENABLE: 3,
  ADDON_DISABLE: 4,
  ADDON_INSTALL: 5,
  ADDON_UNINSTALL: 6,
  ADDON_UPGRADE: 7,
  ADDON_DOWNGRADE: 8,
  MAIN_WINDOW_LOAD: 9,
  MAIN_WINDOW_UNLOAD: 10,
};

/**
 * A callable, constructible object whose every property is itself (absorbs any load-time API touch), except
 * the `overrides`, which a check uses to observe one specific API (e.g. a recording Zotero.Server.Endpoints).
 */
export function inertStub(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  const handler: ProxyHandler<() => void> = {
    get(_target, property) {
      if (typeof property === "string" && Object.hasOwn(overrides, property)) return overrides[property];
      if (property === Symbol.toPrimitive) return () => "";
      if (property === Symbol.iterator) return function* () {};
      // Not a thenable, so `await stub` resolves immediately instead of hanging.
      if (property === "then") return undefined;
      return proxy;
    },
    apply: () => proxy,
    construct: () => proxy as object,
    set: () => true,
  };
  const proxy: unknown = new Proxy(function stub() {}, handler);
  return proxy;
}

export interface ScriptSandbox {
  /** Evaluate a classic script at the top level of this sandbox's global. */
  run(code: string, filename: string): void;
  /** Value of a global the way plugins.js resolves it: own property, else a global lexical binding. */
  lookup(name: string): unknown;
  /** Own property names of the global, to diff what a script added. */
  globalNames(): string[];
  /** Perform `delete globalThis[name]` inside the sandbox; true when the global is gone afterwards. */
  deleteGlobal(name: string): boolean;
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

function identifier(name: string): string {
  if (!IDENTIFIER_RE.test(name)) throw new Error(`not an identifier: ${name}`);
  return name;
}

/** A fresh stub sandbox; `globals` replace the default stub of the same name. */
export function createSandbox(globals: Readonly<Record<string, unknown>> = {}): ScriptSandbox {
  const initial: Record<string, unknown> = {
    ...BOOTSTRAP_REASONS,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    atob,
    btoa,
    console: inertStub(),
  };
  for (const name of STUBBED_GLOBALS) initial[name] = inertStub();
  const context = vm.createContext({ ...initial, ...globals }, { microtaskMode: "afterEvaluate" });
  const evaluate = (code: string): unknown => vm.runInContext(code, context, { timeout: 5000 });
  return {
    run(code, filename) {
      vm.runInContext(code, context, { filename, timeout: 5000 });
    },
    lookup(name) {
      const id = identifier(name);
      if (Object.prototype.hasOwnProperty.call(context, id)) return context[id];
      return evaluate(`typeof ${id} === "undefined" ? undefined : ${id}`);
    },
    globalNames() {
      return [...(evaluate("Object.getOwnPropertyNames(globalThis)") as string[])];
    },
    deleteGlobal(name) {
      const id = identifier(name);
      // The descriptor is not trustworthy here: vm reports a top-level `var` as configurable, yet delete fails.
      return evaluate(`delete globalThis.${id}, typeof ${id} === "undefined"`) === true;
    },
  };
}

/** Evaluate `scripts` in order in one fresh sandbox. */
export function evaluateScripts(scripts: readonly { code: string; filename: string }[]): ScriptSandbox {
  const sandbox = createSandbox();
  for (const script of scripts) sandbox.run(script.code, script.filename);
  return sandbox;
}

/** Names from `required` that are not functions on `holder` (or on the sandbox global when holder is null). */
export function missingFunctions(sandbox: ScriptSandbox, required: readonly string[], holder: string | null = null): string[] {
  if (holder === null) return required.filter((name) => typeof sandbox.lookup(name) !== "function");
  const target = sandbox.lookup(holder);
  if (target === null || (typeof target !== "object" && typeof target !== "function")) {
    return required.map((name) => `${holder}.${name}`);
  }
  const record = target as Record<string, unknown>;
  return required.filter((name) => typeof record[name] !== "function").map((name) => `${holder}.${name}`);
}
