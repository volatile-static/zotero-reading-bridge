/**
 * Pure package checks over archive contents (path -> bytes). Each check returns the list of problems
 * found, so the verifier can print one PASS/FAIL row per check with the reasons.
 */
import {
  BRIDGE_NAME,
  DEFAULT_ZOTERO_PORT,
  ENDPOINT_PATH,
  ENDPOINT_PATHS,
  ZOTERO_ADDON_ID,
  endpointUrl,
} from "../../shared/types/bridge.js";
import { CLIENT_SERVER_NAMES, PLUGIN_NAME } from "../../shared/types/hook.js";
import type { ToolName } from "../../shared/types/tool-names.js";
import { errorMessage } from "./cli.js";
import {
  ENDPOINT_METHODS,
  ENDPOINT_MODULE,
  MAIN_GLOBAL_NAME,
  REQUIRED_BOOTSTRAP_HOOKS,
  REQUIRED_MAIN_METHODS,
  SKILL_FILE,
  SKILL_NAME,
  XPI_LOCALES,
  XPI_REQUIRED_FILES,
  ZOTERO_BUNDLES,
} from "./layout.js";
import { isRecord, parseFrontmatter } from "./manifests.js";
import { scanBundle } from "./scan.js";
import { createSandbox, inertStub, missingFunctions } from "./script-globals.js";

export type FileMap = ReadonlyMap<string, Buffer>;

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Run a check body; thrown errors become failures so one broken file cannot abort the whole report. */
export function runCheck(name: string, body: () => readonly string[]): CheckResult {
  try {
    const problems = body();
    return problems.length === 0 ? { name, ok: true } : { name, ok: false, detail: problems.join("; ") };
  } catch (error) {
    return { name, ok: false, detail: errorMessage(error) };
  }
}

export function readText(files: FileMap, name: string): string {
  const data = files.get(name);
  if (!data) throw new Error(`${name} is missing`);
  return data.toString("utf8").replace(/^\uFEFF/, "");
}

export function readJsonObject(files: FileMap, name: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readText(files, name));
  } catch (error) {
    if (!files.has(name)) throw error;
    throw new Error(`${name}: invalid JSON (${errorMessage(error)})`);
  }
  if (!isRecord(value)) throw new Error(`${name}: top-level value must be an object`);
  return value;
}

const CANONICAL_URL = endpointUrl(DEFAULT_ZOTERO_PORT, ENDPOINT_PATH);

export function zoteroManifestProblems(manifest: Record<string, unknown>, version: string): string[] {
  const problems: string[] = [];
  if (manifest["manifest_version"] !== 2) problems.push("manifest_version must be 2 (Zotero reads applications only in MV2)");
  if (typeof manifest["name"] !== "string" || !manifest["name"]) problems.push("name must be a non-empty string");
  if (manifest["version"] !== version) problems.push(`version must be ${version} (got ${JSON.stringify(manifest["version"])})`);
  const applications = manifest["applications"];
  const zotero = isRecord(applications) ? applications["zotero"] : undefined;
  if (!isRecord(zotero)) return [...problems, "applications.zotero is missing"];
  if (zotero["id"] !== ZOTERO_ADDON_ID) problems.push(`applications.zotero.id must be ${ZOTERO_ADDON_ID}`);
  const updateUrl = zotero["update_url"];
  if (typeof updateUrl !== "string" || !updateUrl.startsWith("https://")) {
    problems.push("applications.zotero.update_url must be an https URL (Zotero refuses manifests without it)");
  }
  const min = zotero["strict_min_version"];
  if (typeof min !== "string" || !min) problems.push("applications.zotero.strict_min_version is missing");
  else if (min.includes("*")) problems.push(`strict_min_version must not contain "*" (got ${min})`);
  const max = zotero["strict_max_version"];
  if (typeof max !== "string" || !max) problems.push("applications.zotero.strict_max_version is missing");
  return problems;
}

/** Icon paths declared by the manifest (all must exist inside the XPI). */
export function manifestIconPaths(manifest: Record<string, unknown>): string[] {
  const icons = manifest["icons"];
  if (!isRecord(icons)) return [];
  return Object.values(icons).filter((value): value is string => typeof value === "string");
}

function cleanRef(ref: string): string {
  return ref.replace(/[?#].*$/, "").replace(/^\.\//, "");
}

/**
 * XPI-relative files a script refers to: `rootURI + "x"`, `${rootURI}x`, and literals starting with
 * content/ or locale/ that name a file (have an extension).
 */
export function scriptResourceRefs(code: string): string[] {
  const refs = new Set<string>();
  for (const m of code.matchAll(/\brootURI\s*\+\s*(["'`])([^"'`$\s]+?)\1/g)) refs.add(cleanRef(m[2] ?? ""));
  for (const m of code.matchAll(/\$\{[^}]*\brootURI\b[^}]*\}([^`$\s"']+)/g)) refs.add(cleanRef(m[1] ?? ""));
  // Any interpolated root (e.g. `${root}content/x.xhtml` with root = data.rootURI) followed by a package path.
  for (const m of code.matchAll(/\$\{[^}]*\}((?:content|locale)\/[^`$\s"']+)/g)) refs.add(cleanRef(m[1] ?? ""));
  for (const m of code.matchAll(/(["'`])((?:content|locale)\/[^"'`\s$?#]+\.[A-Za-z0-9]+)\1/g)) {
    refs.add(cleanRef(m[2] ?? ""));
  }
  refs.delete("");
  return [...refs].sort();
}

/** Fluent files named in string literals (Zotero resolves them under locale/<lang>/). */
export function ftlRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/(["'`])([\w.-]+\.ftl)\1/g)) refs.add(m[2] ?? "");
  refs.delete("");
  return [...refs].sort();
}

export interface MarkupRefs {
  files: string[];
  ftl: string[];
  /** Relative file URLs: a pane fragment resolves them against Zotero's own preferences window. */
  unresolvable: string[];
}

export function markupResourceRefs(markup: string): MarkupRefs {
  const refs: MarkupRefs = { files: [], ftl: [], unresolvable: [] };
  for (const m of markup.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = (m[1] ?? m[2] ?? "").trim();
    if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    const ref = cleanRef(value);
    if (/^[\w.-]+\.ftl$/.test(ref)) refs.ftl.push(ref);
    else if (/^(?:content|locale)\//.test(ref)) refs.files.push(ref);
    else if (/\.[A-Za-z0-9]+$/.test(ref)) refs.unresolvable.push(ref);
  }
  return refs;
}

/** Top-level Fluent message and term ids, in file order. */
export function ftlMessageIds(ftl: string): string[] {
  return [...ftl.matchAll(/^(-?[A-Za-z][\w-]*)[ \t]*=/gm)].map((m) => m[1] ?? "");
}

/** Every file/dir reference made by the XPI's scripts, markup and manifest must exist in the XPI. */
export function xpiReferenceProblems(files: FileMap): string[] {
  const problems: string[] = [];
  const names = [...files.keys()];
  const exists = (ref: string): boolean =>
    ref.endsWith("/") ? names.some((name) => name.startsWith(ref)) : files.has(ref);
  const checkFtl = (ftl: string, from: string): void => {
    for (const locale of XPI_LOCALES) {
      if (!files.has(`locale/${locale}/${ftl}`)) problems.push(`${from} -> locale/${locale}/${ftl} (missing)`);
    }
  };
  for (const script of names.filter((name) => name.endsWith(".js"))) {
    const code = readText(files, script);
    for (const ref of scriptResourceRefs(code)) if (!exists(ref)) problems.push(`${script} -> ${ref} (missing)`);
    for (const ftl of ftlRefs(code)) checkFtl(ftl, script);
  }
  for (const markup of names.filter((name) => name.endsWith(".xhtml"))) {
    const refs = markupResourceRefs(readText(files, markup));
    for (const ref of refs.files) if (!exists(ref)) problems.push(`${markup} -> ${ref} (missing)`);
    for (const ftl of refs.ftl) checkFtl(ftl, markup);
    for (const ref of refs.unresolvable) problems.push(`${markup} -> ${ref} (relative URL resolves outside the plugin)`);
  }
  if (files.has("manifest.json")) {
    for (const icon of manifestIconPaths(readJsonObject(files, "manifest.json"))) {
      if (!exists(cleanRef(icon))) problems.push(`manifest.json icons -> ${icon} (missing)`);
    }
  }
  return problems;
}

/** Zotero 11 merges every plugin's Fluent files into one namespace, so ids must carry our prefix. */
export function ftlProblems(files: FileMap): string[] {
  const problems: string[] = [];
  const idsByLocale = new Map<string, Set<string>>();
  for (const locale of XPI_LOCALES) {
    const ids = new Set<string>();
    for (const name of [...files.keys()].filter((n) => n.startsWith(`locale/${locale}/`) && n.endsWith(".ftl"))) {
      for (const id of ftlMessageIds(readText(files, name))) {
        if (!id.replace(/^-/, "").startsWith(`${BRIDGE_NAME}-`)) problems.push(`${name}: id "${id}" lacks the ${BRIDGE_NAME}- prefix`);
        if (ids.has(id)) problems.push(`${name}: duplicate id "${id}"`);
        ids.add(id);
      }
    }
    if (ids.size === 0) problems.push(`locale/${locale}: no Fluent messages`);
    idsByLocale.set(locale, ids);
  }
  for (const [locale, ids] of idsByLocale) {
    for (const [other, otherIds] of idsByLocale) {
      if (other === locale) continue;
      for (const id of ids) if (!otherIds.has(id)) problems.push(`"${id}" is in ${locale} but not in ${other}`);
    }
  }
  return problems;
}

function isDevArtifact(name: string): boolean {
  return /\.(?:[cm]?ts|tsx|map)$/.test(name) || /(?:^|\/)tsconfig(?:\.[\w-]+)?\.json$/.test(name);
}

/**
 * The global contract between the two scripts, proven by loading them the way Zotero does: plugins.js
 * evaluates bootstrap.js into the plugin sandbox and resolves hooks as `scope[method] || evalInSandbox(method)`;
 * bootstrap.js then evaluates content/bridge.js into that same sandbox (`target: globalThis`), which must add
 * exactly ZoteroAIBridgeMain {startup, shutdown}, leave the hooks alone, and stay deletable for shutdown.
 */
export function bundleContractProblems(bootstrapCode: string, bridgeCode: string): string[] {
  const sandbox = createSandbox();
  try {
    sandbox.run(bootstrapCode, "bootstrap.js");
  } catch (error) {
    return [`bootstrap.js threw while loading: ${errorMessage(error)}`];
  }
  const problems = missingFunctions(sandbox, REQUIRED_BOOTSTRAP_HOOKS).map((name) => `bootstrap.js: ${name} is not a global function`);
  const hooks = new Map(REQUIRED_BOOTSTRAP_HOOKS.map((name) => [name, sandbox.lookup(name)]));
  const before = new Set(sandbox.globalNames());
  try {
    sandbox.run(bridgeCode, "content/bridge.js");
  } catch (error) {
    return [...problems, `content/bridge.js threw while loading: ${errorMessage(error)}`];
  }
  const added = sandbox.globalNames().filter((name) => !before.has(name));
  if (added.length !== 1 || added[0] !== MAIN_GLOBAL_NAME) {
    problems.push(`content/bridge.js must add exactly the global ${MAIN_GLOBAL_NAME} (added: [${added.join(", ")}])`);
  }
  problems.push(
    ...missingFunctions(sandbox, REQUIRED_MAIN_METHODS, MAIN_GLOBAL_NAME).map((name) => `content/bridge.js: ${name} is not a function`),
  );
  for (const [name, hook] of hooks) {
    if (sandbox.lookup(name) !== hook) problems.push(`content/bridge.js replaced the bootstrap hook ${name}`);
  }
  if (sandbox.lookup(MAIN_GLOBAL_NAME) !== undefined && !sandbox.deleteGlobal(MAIN_GLOBAL_NAME)) {
    problems.push(`${MAIN_GLOBAL_NAME} cannot be deleted by bootstrap.js shutdown (assign globalThis.${MAIN_GLOBAL_NAME}, not a top-level var)`);
  }
  problems.push(...restartProblems(bootstrapCode));
  return problems;
}

/**
 * plugins.js can call startup() twice without a shutdown in between (onOperationCancelled after an uninstall and
 * reinstall in one session). Every startup re-evaluates content/bridge.js, whose fresh closure cannot reach the
 * earlier runtime, so bootstrap.js itself must shut the previous ZoteroAIBridgeMain down before loading the bundle
 * again; otherwise that runtime's endpoints (whenever the new runtime does not serve), Notifier observer,
 * response-code patch and pane are never released, not even by a later disable. Checked with a script loader stub
 * that publishes a recording ZoteroAIBridgeMain on every load; startup() runs synchronously up to its first await.
 */
export function restartProblems(bootstrapCode: string): string[] {
  const events: string[] = [];
  let loads = 0;
  const scriptloader = {
    loadSubScriptWithOptions(_url: unknown, options: { target?: Record<string, unknown> } | undefined): void {
      const instance = ++loads;
      if (!options?.target) return;
      options.target[MAIN_GLOBAL_NAME] = {
        startup: () => {
          events.push(`startup ${instance}`);
          return Promise.resolve();
        },
        shutdown: () => {
          events.push(`shutdown ${instance}`);
        },
      };
    },
  };
  const sandbox = createSandbox({ Services: inertStub({ scriptloader }) });
  try {
    sandbox.run(bootstrapCode, "bootstrap.js");
  } catch (error) {
    return [`bootstrap.js threw while loading: ${errorMessage(error)}`];
  }
  const startup = sandbox.lookup("startup");
  const shutdown = sandbox.lookup("shutdown");
  if (typeof startup !== "function" || typeof shutdown !== "function") return [];
  const data = { id: ZOTERO_ADDON_ID, version: "0.0.0", rootURI: "jar:file:///zotero-ai-bridge.xpi!/" };
  try {
    void startup(data, 3);
    void startup(data, 3);
    shutdown(data, 4);
  } catch (error) {
    return [`bootstrap.js startup/shutdown threw with a stub runtime: ${errorMessage(error)}`];
  }
  const expected = ["startup 1", "shutdown 1", "startup 2", "shutdown 2"];
  return events.join(",") === expected.join(",")
    ? []
    : [`bootstrap.js startup() without a shutdown in between must stop the previous runtime first (expected ${expected.join(", ")}; got ${events.join(", ") || "nothing"})`];
}

/**
 * Build-time check of design decision 12 on a check-only bundle of src/server/endpoint.ts (built with the
 * release options, exports exposed as `var <globalName>`): registerEndpoints() must put one class on every
 * bridge path whose instances declare init(request) with exactly one parameter (Zotero picks the calling
 * convention by init.length), accept every method and data type itself, and unregister() must remove only paths
 * that still map to that class.
 */
export function endpointRegistrationProblems(inspectionCode: string, globalName: string): string[] {
  const endpoints: Record<string, unknown> = {};
  const sandbox = createSandbox({ Zotero: inertStub({ Server: inertStub({ Endpoints: endpoints }) }) });
  sandbox.run(inspectionCode, ENDPOINT_MODULE);
  const api = sandbox.lookup(globalName);
  const register = isRecord(api) ? api["registerEndpoints"] : undefined;
  if (typeof register !== "function") return [`${ENDPOINT_MODULE} does not export registerEndpoints()`];
  const registration: unknown = register({ registry: inertStub(), serverVersion: "0.0.0", instructions: "", port: DEFAULT_ZOTERO_PORT });
  const problems: string[] = [];
  const endpoint = endpoints[ENDPOINT_PATH];
  if (typeof endpoint !== "function") return [`registerEndpoints() did not register ${ENDPOINT_PATH}`];
  for (const path of ENDPOINT_PATHS) {
    if (endpoints[path] !== endpoint) problems.push(`${path} is not registered with the same endpoint class`);
  }
  const instance = new (endpoint as new () => Record<string, unknown>)();
  const init = instance["init"];
  if (typeof init !== "function") problems.push("endpoint instances have no init()");
  else if (init.length !== 1) problems.push(`endpoint init.length is ${init.length}; Zotero needs exactly 1 (no default or rest parameters)`);
  const methods = instance["supportedMethods"];
  const missingMethods = ENDPOINT_METHODS.filter((method) => !Array.isArray(methods) || !methods.includes(method));
  if (missingMethods.length > 0) problems.push(`supportedMethods lacks ${missingMethods.join(", ")}`);
  if (instance["supportedDataTypes"] !== "*") problems.push(`supportedDataTypes must be "*"`);

  const unregister = isRecord(registration) ? registration["unregister"] : undefined;
  if (typeof unregister !== "function") return [...problems, "registerEndpoints() returned no unregister()"];
  const [primary, ...aliases] = ENDPOINT_PATHS;
  const foreign = function foreignEndpoint(): void {};
  for (const alias of aliases) endpoints[alias] = foreign;
  unregister.call(registration);
  if (primary !== undefined && primary in endpoints) problems.push(`unregister() left ${primary} registered`);
  for (const alias of aliases) {
    if (endpoints[alias] !== foreign) problems.push(`unregister() removed ${alias}, which another endpoint had taken over`);
  }
  return problems;
}

/**
 * Shipped-bundle counterpart of endpointRegistrationProblems (the verifier has no sources): every class body
 * that declares supportedDataTypes must define init() with exactly one plain parameter.
 */
export function endpointInitProblems(code: string): string[] {
  const problems: string[] = [];
  let classes = 0;
  for (const match of code.matchAll(/\bsupportedDataTypes\s*=/g)) {
    classes++;
    const init = /\n[ \t]*(?:async[ \t]+)?init[ \t]*\(([^)]*)\)[ \t]*\{/.exec(code.slice(match.index, match.index + 2000));
    if (!init) problems.push(`no init() method follows supportedDataTypes at offset ${match.index}`);
    else if (!/^\s*[A-Za-z_$][\w$]*\s*$/.test(init[1] ?? "")) {
      problems.push(`init(${(init[1] ?? "").trim()}) must declare exactly one plain parameter`);
    }
  }
  if (classes === 0) problems.push("no endpoint class (supportedDataTypes) found");
  return problems;
}

export function xpiPackageChecks(files: FileMap, version: string): CheckResult[] {
  return [
    runCheck("required files present", () => XPI_REQUIRED_FILES.filter((f) => !files.has(f)).map((f) => `missing ${f}`)),
    runCheck("manifest.json fields", () => zoteroManifestProblems(readJsonObject(files, "manifest.json"), version)),
    runCheck("no TypeScript sources, tsconfig or source maps", () =>
      [...files.keys()].filter(isDevArtifact).map((name) => `unexpected ${name}`),
    ),
    ...ZOTERO_BUNDLES.map((spec) =>
      runCheck(`${spec.out} has no require/import/export/node:/process.env`, () => scanBundle(readText(files, spec.out))),
    ),
    runCheck(`bootstrap.js hooks + content/bridge.js ${MAIN_GLOBAL_NAME} in one sandbox`, () =>
      bundleContractProblems(readText(files, "bootstrap.js"), readText(files, "content/bridge.js")),
    ),
    runCheck("bootstrap.js loads content/bridge.js", () =>
      readText(files, "bootstrap.js").includes("content/bridge.js") ? [] : ["bootstrap.js never mentions content/bridge.js"],
    ),
    runCheck("content/bridge.js endpoint init() declares one parameter", () => endpointInitProblems(readText(files, "content/bridge.js"))),
    runCheck("resource references resolve inside the XPI", () => xpiReferenceProblems(files)),
    runCheck("Fluent ids prefixed and identical across locales", () => ftlProblems(files)),
  ];
}

export const HOOK_TOOL: ToolName = "capture_prompt_context";
export const HOOK_TIMEOUT_SEC = 5;
export const HOOK_STATUS_MESSAGE = "Reading Zotero context";
const HOOK_HANDLER_KEYS = new Set(["type", "server", "tool", "input", "timeout", "statusMessage"]);

export interface HookExpectation {
  server: string;
  input: Readonly<Record<string, string>>;
  /** Codex's HooksFile is deny_unknown_fields with `description` + `hooks`; the design ships both. */
  requireDescription: boolean;
}

/** The plugin's hooks.json must hold exactly one UserPromptSubmit mcp_tool hook shaped per design decision 3. */
export function hookFileProblems(hooksFile: Record<string, unknown>, expected: HookExpectation): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(hooksFile)) {
    if (key !== "description" && key !== "hooks") problems.push(`unexpected top-level key "${key}"`);
  }
  if (expected.requireDescription && typeof hooksFile["description"] !== "string") {
    problems.push(`top-level "description" string is required`);
  }
  const events = hooksFile["hooks"];
  if (!isRecord(events)) return [...problems, `"hooks" must be an object`];
  for (const event of Object.keys(events)) {
    if (event !== "UserPromptSubmit") problems.push(`unexpected hook event "${event}"`);
  }
  const groups = events["UserPromptSubmit"];
  if (!Array.isArray(groups) || groups.length === 0) return [...problems, "UserPromptSubmit hook is missing"];
  const handlers: unknown[] = [];
  for (const group of groups) {
    if (!isRecord(group)) {
      problems.push("UserPromptSubmit group must be an object");
      continue;
    }
    for (const key of Object.keys(group)) {
      if (key !== "hooks") problems.push(`unexpected group key "${key}" (no matcher on UserPromptSubmit)`);
    }
    if (Array.isArray(group["hooks"])) handlers.push(...(group["hooks"] as unknown[]));
    else problems.push(`group "hooks" must be an array`);
  }
  if (handlers.length !== 1) return [...problems, `expected exactly one UserPromptSubmit handler, found ${handlers.length}`];
  const handler = handlers[0];
  if (!isRecord(handler)) return [...problems, "handler must be an object"];
  for (const key of Object.keys(handler)) {
    if (!HOOK_HANDLER_KEYS.has(key)) problems.push(`unexpected handler key "${key}"`);
  }
  if (handler["type"] !== "mcp_tool") problems.push(`type must be "mcp_tool"`);
  if (handler["server"] !== expected.server) {
    problems.push(`server must be "${expected.server}" (got ${JSON.stringify(handler["server"])})`);
  }
  if (handler["tool"] !== HOOK_TOOL) problems.push(`tool must be "${HOOK_TOOL}"`);
  const timeout = handler["timeout"];
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout !== HOOK_TIMEOUT_SEC) {
    problems.push(`timeout must be the integer ${HOOK_TIMEOUT_SEC}`);
  }
  if (handler["statusMessage"] !== HOOK_STATUS_MESSAGE) problems.push(`statusMessage must be "${HOOK_STATUS_MESSAGE}"`);
  const input = handler["input"];
  if (!isRecord(input)) {
    problems.push("input must be an object");
  } else {
    const expectedKeys = Object.keys(expected.input).sort();
    const actualKeys = Object.keys(input).sort();
    if (expectedKeys.join(",") !== actualKeys.join(",")) {
      problems.push(`input keys must be exactly [${expectedKeys.join(", ")}] (got [${actualKeys.join(", ")}])`);
    }
    for (const [key, value] of Object.entries(expected.input)) {
      if (key in input && input[key] !== value) problems.push(`input.${key} must be ${JSON.stringify(value)}`);
    }
  }
  return problems;
}

/** Problems with the one HTTP server a client plugin's .mcp.json must declare. */
export function mcpConfigProblems(mcp: Record<string, unknown>, serverKey: string, client: "codex" | "claude-code"): string[] {
  const servers = mcp["mcpServers"];
  if (!isRecord(servers)) return [`"mcpServers" must be an object`];
  const keys = Object.keys(servers);
  if (keys.length !== 1 || keys[0] !== serverKey) {
    return [`mcpServers must declare exactly "${serverKey}" (got [${keys.join(", ")}])`];
  }
  const server = servers[serverKey];
  if (!isRecord(server)) return [`mcpServers.${serverKey} must be an object`];
  const problems: string[] = [];
  if (server["type"] !== "http") problems.push(`mcpServers.${serverKey}.type must be "http"`);
  if (server["url"] !== CANONICAL_URL) problems.push(`mcpServers.${serverKey}.url must be ${CANONICAL_URL}`);
  if (client === "codex") {
    // The shipped plugin must not relax Codex's approval policy or embed a literal credential.
    for (const key of ["default_tools_approval_mode", "bearer_token"]) {
      if (key in server) problems.push(`mcpServers.${serverKey}.${key} must not be set`);
    }
  }
  return problems;
}

export function skillProblems(files: FileMap, skillPath: string = SKILL_FILE): string[] {
  const frontmatter = parseFrontmatter(readText(files, skillPath));
  if (!frontmatter) return [`${skillPath} has no YAML front matter`];
  const problems: string[] = [];
  if (frontmatter["name"] !== SKILL_NAME) problems.push(`front matter name must be "${SKILL_NAME}"`);
  const description = frontmatter["description"] ?? "";
  if (!description.trim()) problems.push("front matter description is empty");
  else if (description.length > 1024) problems.push("front matter description exceeds 1024 characters");
  return problems;
}

/** Manifest path fields (Codex) must be "./"-relative, stay inside the plugin and point at shipped files. */
function manifestPathProblems(manifest: Record<string, unknown>, files: FileMap, fields: readonly string[]): string[] {
  const problems: string[] = [];
  for (const field of fields) {
    const value = manifest[field];
    if (value === undefined || typeof value !== "string") continue;
    if (!value.startsWith("./") || value.split("/").includes("..")) {
      problems.push(`${field} must start with "./" and stay inside the plugin (got ${value})`);
      continue;
    }
    const rel = value.slice(2).replace(/\/+$/, "");
    const exists = rel === "" || files.has(rel) || [...files.keys()].some((name) => name.startsWith(`${rel}/`));
    if (!exists) problems.push(`${field} points at ${value}, which is not in the package`);
  }
  return problems;
}

function pluginIdentityProblems(manifest: Record<string, unknown>, version: string): string[] {
  const problems: string[] = [];
  if (manifest["name"] !== PLUGIN_NAME) problems.push(`name must be "${PLUGIN_NAME}"`);
  if (manifest["version"] !== version) problems.push(`version must be ${version} (got ${JSON.stringify(manifest["version"])})`);
  return problems;
}

export function codexPackageChecks(files: FileMap, version: string): CheckResult[] {
  const serverKey = CLIENT_SERVER_NAMES.codex;
  return [
    runCheck(".codex-plugin/plugin.json identity and paths", () => {
      const manifest = readJsonObject(files, ".codex-plugin/plugin.json");
      const ui = manifest["interface"];
      return [
        ...pluginIdentityProblems(manifest, version),
        ...manifestPathProblems(manifest, files, ["skills", "mcpServers", "hooks"]),
        ...(isRecord(ui) ? manifestPathProblems(ui, files, ["composerIcon", "logo"]).map((p) => `interface.${p}`) : []),
      ];
    }),
    runCheck(`.mcp.json declares ${serverKey}`, () => mcpConfigProblems(readJsonObject(files, ".mcp.json"), serverKey, "codex")),
    runCheck("hooks/hooks.json UserPromptSubmit hook", () =>
      hookFileProblems(readJsonObject(files, "hooks/hooks.json"), {
        server: serverKey,
        input: { client: "codex", session_id: "${session_id}", turn_id: "${turn_id}" },
        requireDescription: true,
      }),
    ),
    runCheck(`${SKILL_FILE} front matter`, () => skillProblems(files)),
  ];
}

export function claudeCodePackageChecks(files: FileMap, version: string): CheckResult[] {
  const serverKey = CLIENT_SERVER_NAMES.claudeCode;
  return [
    runCheck(".claude-plugin/plugin.json identity", () => {
      const manifest = readJsonObject(files, ".claude-plugin/plugin.json");
      const problems = pluginIdentityProblems(manifest, version);
      // Declaring these would replace (not merge with) the default hooks/hooks.json and .mcp.json.
      for (const key of ["hooks", "mcpServers"]) {
        if (key in manifest) problems.push(`must not declare "${key}"`);
      }
      return problems;
    }),
    runCheck(`.mcp.json declares ${serverKey}`, () =>
      mcpConfigProblems(readJsonObject(files, ".mcp.json"), serverKey, "claude-code"),
    ),
    runCheck("hooks/hooks.json UserPromptSubmit hook", () => {
      const manifest = readJsonObject(files, ".claude-plugin/plugin.json");
      const derived = `plugin:${String(manifest["name"])}:${serverKey}`;
      const problems =
        derived === CLIENT_SERVER_NAMES.claudeCodeHookServer
          ? []
          : [`hook server ${CLIENT_SERVER_NAMES.claudeCodeHookServer} does not match plugin:<name>:<server key> = ${derived}`];
      return [
        ...problems,
        ...hookFileProblems(readJsonObject(files, "hooks/hooks.json"), {
          server: CLIENT_SERVER_NAMES.claudeCodeHookServer,
          input: { client: "claude-code", session_id: "${session_id}", prompt_id: "${prompt_id}" },
          requireDescription: false,
        }),
      ];
    }),
    runCheck(`${SKILL_FILE} front matter`, () => skillProblems(files)),
  ];
}
