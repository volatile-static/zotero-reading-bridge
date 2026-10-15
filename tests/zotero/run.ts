/**
 * Live Zotero integration harness (DESIGN 2.G). `npm run test:zotero` runs it.
 *
 * Launches the installed Zotero as a SEPARATE instance (`-profile <throwaway> -no-remote -datadir
 * <throwaway>`) on port 23139 with the test-only seed plugin and, when outputs/zotero-ai-bridge.xpi has
 * been built, the bridge add-on. Seeds the fixture library, runs every case over HTTP, shuts down only
 * the process it launched, and proves the user's real Zotero profile was not touched.
 *
 * Options: --seed-only (do not install the bridge even if built), --only <prefix[,prefix]> (run a subset
 * of cases; infrastructure cases always run), --debug-output (Zotero debug log into logs/; enables the
 * harness.debug-log-privacy check of the bridge's own debug lines).
 * Environment: ZAB_ZOTERO_EXE (another zotero.exe), ZAB_BRIDGE_XPI (test a candidate XPI instead of outputs/).
 * Exit code: 0 when no case failed (skips are not failures), 1 otherwise, 2 when the run could not start.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ZOTERO_ADDON_ID } from "../../shared/types/bridge.js";
import { LATEST_PROTOCOL_VERSION } from "../../shared/types/mcp.js";
import { buildSeedXpi } from "./build-seed.js";
import { allCases } from "./cases/index.js";
import { SkipCase, type HarnessContext, type TestCase } from "./cases/types.js";
import { checkBridgeDebugLines, fixtureTexts } from "./lib/debug-log.js";
import { portOpen } from "./lib/http.js";
import { McpClient } from "./lib/mcp.js";
import {
  BRIDGE_XPI,
  REAL_ZOTERO_PORT,
  REPORT_PATH,
  REPO_ROOT,
  TEST_PORT,
  TEST_ROOT,
  WORK_ROOT,
  ZOTERO_EXE,
  assertTestPath,
  isInside,
} from "./lib/paths.js";
import {
  allProcesses,
  launchZotero,
  processTree,
  stopZotero,
  tcpListeners,
  visibleWindows,
  waitForServer,
  type Listener,
  type ProcessInfo,
  type StopResult,
  type ZoteroProcess,
} from "./lib/process.js";
import { SeedClient } from "./lib/seed-client.js";
import {
  captureRealProfileState,
  createRunLayout,
  diffRealProfileState,
  installAddon,
  testProfilePrefs,
  writeUserJs,
  type RunLayout,
} from "./profile.js";
import { SEED_ADDON_ID } from "./seed-api.js";

type Status = "pass" | "fail" | "skip";

interface CaseResult {
  id: string;
  title: string;
  status: Status;
  ms: number;
  reason: string | null;
  details: unknown;
}

interface Options {
  seedOnly: boolean;
  only: string[] | null;
  debugOutput: boolean;
}

const STARTUP_TIMEOUT_MS = 180_000;
const SEED_READY_TIMEOUT_MS = 120_000;
const DEFAULT_CASE_TIMEOUT_MS = 60_000;
const QUIT_GRACE_MS = 30_000;
/** Infrastructure cases run even with --only, since every other case depends on them. */
const ALWAYS_RUN = ["harness.", "seed.fixtures", "seed.query"];

function parseOptions(argv: string[]): Options {
  const options: Options = { seedOnly: false, only: null, debugOutput: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed-only") options.seedOnly = true;
    else if (arg === "--debug-output") options.debugOutput = true;
    else if (arg === "--only") options.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Refuse to start unless every location is inside work/zotero-test and the test port is free. */
async function preflight(): Promise<{ realListeners: Listener[]; realListenerProcesses: ProcessInfo[] }> {
  if (process.platform !== "win32") throw new Error("The live harness drives the Windows build of Zotero");
  if (path.resolve(WORK_ROOT) !== path.resolve(REPO_ROOT, "work") || !isInside(WORK_ROOT, TEST_ROOT)) {
    throw new Error(`Test root ${TEST_ROOT} is not inside ${path.join(REPO_ROOT, "work")}`);
  }
  if (!fs.existsSync(ZOTERO_EXE)) throw new Error(`Zotero executable not found: ${ZOTERO_EXE}`);
  const busy = await tcpListeners(TEST_PORT);
  if (busy.length || (await portOpen(TEST_PORT, 500))) {
    // Possibly a leftover test instance; the harness never kills a process it did not launch in this run.
    throw new Error(`Port ${TEST_PORT} is already in use (PIDs ${busy.map((l) => l.pid).join(", ") || "unknown"}); stop that process first`);
  }
  const realListeners = await tcpListeners(REAL_ZOTERO_PORT);
  const all = await allProcesses();
  return { realListeners, realListenerProcesses: all.filter((p) => realListeners.some((l) => l.pid === p.pid)) };
}

/**
 * Ctrl+C would otherwise leave the test instance running on the test port (blocking the next run). Only the
 * launched process tree is killed; the child handle Node holds keeps its PID from being reused.
 */
function killOnInterrupt(proc: ZoteroProcess): void {
  const handler = (signal: NodeJS.Signals) => {
    if (!proc.exitInfo) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
        // Already gone.
      }
    }
    console.error(`Interrupted (${signal}); stopped the test instance (PID ${proc.pid}).`);
    process.exit(130);
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}

async function prepareProfile(layout: RunLayout, withBridge: boolean): Promise<Record<string, unknown>> {
  const seedXpi = await buildSeedXpi(path.join(layout.addonsDir, "zab-test-seed.xpi"));
  const installed: Record<string, unknown> = { seed: installAddon(layout, SEED_ADDON_ID, seedXpi) };
  if (withBridge) {
    installed.bridge = installAddon(layout, ZOTERO_ADDON_ID, BRIDGE_XPI);
    installed.bridgeSha256 = sha256File(BRIDGE_XPI);
  }
  installed.userJs = writeUserJs(layout, testProfilePrefs(layout, TEST_PORT));
  return installed;
}

/** The seed plugin registers its endpoints after Zotero.initializationPromise; wait for them and the UI. */
async function waitForSeedPlugin(seed: SeedClient, proc: ZoteroProcess): Promise<void> {
  const deadline = Date.now() + SEED_READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    if (proc.exitInfo) throw new Error(`Zotero exited (code ${proc.exitInfo.code}) before the seed plugin was ready`);
    try {
      const state = await seed.state();
      if (state.uiReady) return;
      last = "UI not ready yet";
    } catch (error) {
      last = errorText(error);
    }
    await delay(500);
  }
  throw new Error(`Seed plugin not ready within ${SEED_READY_TIMEOUT_MS} ms (${last})`);
}

function selected(testCase: TestCase, options: Options): boolean {
  if (!options.only) return true;
  return [...ALWAYS_RUN, ...options.only].some((prefix) => testCase.id.startsWith(prefix));
}

function timeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

async function runCase(testCase: TestCase, ctx: HarnessContext, bridgeSkipReason: string | null): Promise<CaseResult> {
  const base = { id: testCase.id, title: testCase.title };
  if (testCase.requires.includes("bridge") && bridgeSkipReason) {
    return { ...base, status: "skip", ms: 0, reason: bridgeSkipReason, details: null };
  }
  if (testCase.requires.includes("fixtures") && !ctx.manifest) {
    // Blocked by the seed failure, which is already reported as a failure of its own.
    return { ...base, status: "skip", ms: 0, reason: "blocked: fixtures were not seeded (see seed.fixtures)", details: null };
  }
  if (ctx.proc.exitInfo) {
    return { ...base, status: "fail", ms: 0, reason: `Zotero is no longer running (exit code ${ctx.proc.exitInfo.code})`, details: null };
  }
  const started = Date.now();
  try {
    const details = await timeout(testCase.run(ctx), testCase.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS, testCase.id);
    return { ...base, status: "pass", ms: Date.now() - started, reason: null, details: details ?? null };
  } catch (error) {
    const skipped = error instanceof SkipCase;
    return {
      ...base,
      status: skipped ? "skip" : "fail",
      ms: Date.now() - started,
      reason: errorText(error),
      details: skipped || !(error instanceof Error) ? null : { stack: error.stack?.split("\n").slice(0, 6).join("\n") },
    };
  }
}

function logTail(file: string, lines = 40): string[] {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

/** Needs the complete debug output, so it runs after shutdown, like harness.shutdown. */
function debugLogPrivacy(options: Options, bridgeSkipReason: string | null, proc: ZoteroProcess | null): CaseResult {
  const base = {
    id: "harness.debug-log-privacy",
    title: "With Zotero debug output on, every bridge debug line is a content-free summary",
    ms: 0,
  };
  const skipReason = bridgeSkipReason ?? (options.debugOutput ? null : "run without --debug-output (no Zotero debug log to check)");
  if (skipReason || !proc) {
    return { ...base, status: "skip", reason: skipReason ?? "Zotero was not launched", details: null };
  }
  const check = checkBridgeDebugLines(fs.readFileSync(proc.logFile, "utf8").split(/\r?\n/), fixtureTexts());
  // Zero lines would prove nothing (e.g. -ZoteroDebugText ignored), so it fails too.
  const problems = [
    ...(check.bridgeLines === 0 ? ["no [Zotero AI Bridge] lines in the debug output"] : []),
    ...check.unexpected.map((line) => `unexpected line: ${line}`),
    ...check.leaking.map((line) => `fixture text in: ${line}`),
  ];
  return {
    ...base,
    status: problems.length ? "fail" : "pass",
    reason: problems.length ? problems.slice(0, 5).join("; ") : null,
    details: check,
  };
}

function printSummary(results: CaseResult[]): void {
  const width = Math.max(...results.map((r) => r.id.length), 4);
  console.log(`\n${"STATUS".padEnd(6)}  ${"CASE".padEnd(width)}  ${"MS".padStart(7)}  NOTE`);
  for (const r of results) {
    const note = r.reason ? r.reason.replace(/\s+/g, " ").slice(0, 160) : "";
    console.log(`${r.status.toUpperCase().padEnd(6)}  ${r.id.padEnd(width)}  ${String(r.ms).padStart(7)}  ${note}`);
  }
  const count = (status: Status) => results.filter((r) => r.status === status).length;
  console.log(`\n${count("pass")} passed, ${count("fail")} failed, ${count("skip")} skipped (${results.length} cases)`);
}

function writeReport(report: Record<string, unknown>, layout: RunLayout | null): string[] {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const targets = [assertTestPath(REPORT_PATH, "report")];
  if (layout) targets.push(assertTestPath(path.join(layout.runDir, "report.json"), "run report"));
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, "utf8");
  }
  return targets;
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = new Date();
  const bridgeBuilt = fs.existsSync(BRIDGE_XPI);
  const withBridge = bridgeBuilt && !options.seedOnly;
  const bridgeSkipReason = withBridge ? null : bridgeBuilt ? "bridge not installed (--seed-only)" : "bridge XPI not built";
  const results: CaseResult[] = [];
  const report: Record<string, unknown> = {
    startedAt: startedAt.toISOString(),
    mode: withBridge ? "bridge" : "seed-only",
    zoteroExe: ZOTERO_EXE,
    port: TEST_PORT,
    bridgeXpi: bridgeBuilt ? BRIDGE_XPI : null,
    options,
    results,
  };

  let layout: RunLayout | null = null;
  let proc: ZoteroProcess | null = null;
  let tree: ProcessInfo[] = [];
  let stop: StopResult | null = null;
  const realBefore = captureRealProfileState();
  try {
    const pre = await preflight();
    report.userZoteroBefore = { listeners: pre.realListeners, processes: pre.realListenerProcesses };
    layout = createRunLayout();
    report.runId = layout.runId;
    report.runDir = layout.runDir;
    report.profile = await prepareProfile(layout, withBridge);
    console.log(`Run ${layout.runId}: ${withBridge ? "bridge" : "seed-only"} mode, Zotero ${ZOTERO_EXE}, port ${TEST_PORT}`);
    console.log(`Profile ${layout.profileDir}\nData    ${layout.dataDir}`);

    proc = launchZotero(ZOTERO_EXE, layout, { debugOutput: options.debugOutput });
    killOnInterrupt(proc);
    report.launch = { pid: proc.pid, args: proc.args, logFile: proc.logFile };
    const startupMs = await waitForServer(proc, TEST_PORT, STARTUP_TIMEOUT_MS).catch(async (error: unknown) => {
      const pids = proc ? (await processTree(proc.pid).catch(() => [])).map((p) => p.pid) : [];
      const windows = await visibleWindows(pids).catch(() => []);
      throw new Error(`${errorText(error)}; visible windows: ${JSON.stringify(windows)}`);
    });
    tree = await processTree(proc.pid);
    const seed = new SeedClient(TEST_PORT, layout.token);
    await waitForSeedPlugin(seed, proc);
    report.startup = { serverMs: startupMs, readyMs: Date.now() - proc.startedAt, processTree: tree };

    const ctx: HarnessContext = {
      port: TEST_PORT,
      layout,
      seed,
      proc,
      bridgeInstalled: withBridge,
      manifest: null,
      observed: null,
      mcp: (endpointPath = "/bridge/mcp", version = LATEST_PROTOCOL_VERSION) => new McpClient(TEST_PORT, endpointPath, version),
    };
    for (const testCase of allCases.filter((c) => selected(c, options))) {
      const result = await runCase(testCase, ctx, bridgeSkipReason);
      results.push(result);
      console.log(`${result.status.toUpperCase().padEnd(4)} ${result.id}${result.reason ? ` - ${result.reason.split("\n")[0]}` : ""}`);
    }
  } catch (error) {
    results.push({ id: "harness.launch", title: "Prepare and launch the test instance", status: "fail", ms: 0, reason: errorText(error), details: null });
    console.error(`Harness error: ${errorText(error)}`);
  } finally {
    if (proc) {
      // Refresh the tree right before quitting: helper processes start lazily (e.g. the reader's).
      tree = [...tree, ...(await processTree(proc.pid).catch(() => []))].filter(
        (p, i, all) => all.findIndex((q) => q.pid === p.pid && q.created === p.created) === i,
      );
      if (!proc.exitInfo && layout) {
        await new SeedClient(TEST_PORT, layout.token).quit().catch(() => undefined);
      }
      stop = await stopZotero(proc, tree, QUIT_GRACE_MS);
      report.shutdown = stop;
      report.zoteroLogTail = logTail(proc.logFile);
    }
  }

  if (proc && stop) {
    const portClosed = !(await portOpen(TEST_PORT, 1000));
    const ok = stop.graceful && stop.leftovers.length === 0 && portClosed;
    results.push({
      id: "harness.shutdown",
      title: "Only the launched instance was stopped, cleanly, and the test port is closed",
      status: ok ? "pass" : "fail",
      ms: stop.ms,
      reason: ok ? null : `graceful=${stop.graceful} leftovers=${stop.leftovers.map((p) => p.pid).join(",") || "none"} portClosed=${portClosed}`,
      details: { ...stop, portClosed },
    });
  }

  results.push(debugLogPrivacy(options, bridgeSkipReason, proc));

  const realAfter = captureRealProfileState();
  const diffs = diffRealProfileState(realBefore, realAfter);
  const before = report.userZoteroBefore as { processes: ProcessInfo[] } | undefined;
  // A Zotero the user runs meanwhile legitimately rewrites its own prefs.js/database: still a failure
  // (it cannot be told apart), but the reason says so.
  const userRunning = (before?.processes.length ?? 0) > 0 ? " (the user's own Zotero was running and may have written these itself)" : "";
  results.push({
    id: "harness.real-profile-untouched",
    title: "The user's real Zotero profile, profiles.ini and data directory are unchanged",
    status: diffs.length === 0 ? "pass" : "fail",
    ms: 0,
    reason: diffs.length ? `${diffs.join("; ")}${userRunning}` : null,
    details: { before: realBefore.files, after: realAfter.files },
  });
  if (before) {
    const now = await allProcesses().catch(() => [] as ProcessInfo[]);
    const gone = before.processes.filter((p) => !now.some((q) => q.pid === p.pid && q.created === p.created));
    results.push({
      id: "harness.user-zotero-untouched",
      title: `A Zotero already serving port ${REAL_ZOTERO_PORT} is still running`,
      status: gone.length === 0 ? "pass" : "fail",
      ms: 0,
      reason: gone.length ? `processes gone: ${gone.map((p) => `${p.pid}:${p.name}`).join(", ")}` : before.processes.length ? null : `no Zotero was listening on ${REAL_ZOTERO_PORT}`,
      details: before,
    });
  }

  const failed = results.filter((r) => r.status === "fail").length;
  report.finishedAt = new Date().toISOString();
  report.summary = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: failed,
    skip: results.filter((r) => r.status === "skip").length,
  };
  printSummary(results);
  const written = writeReport(report, layout);
  console.log(`Report: ${written.join(" and ")}`);
  if (results.some((r) => r.id === "harness.launch")) return 2;
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(2);
  },
);
