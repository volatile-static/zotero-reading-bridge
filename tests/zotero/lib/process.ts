/**
 * Launches and stops the SEPARATE test instance of Zotero, and inspects it from the outside (Windows):
 * its process tree, which process owns the test port and on which address, and its visible windows (to
 * diagnose a modal dialog that blocks startup).
 *
 * Only the process the harness spawned (and that process's own descendants) is ever terminated; the
 * user's Zotero, which may be running on 23119, is never touched.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RunLayout } from "../profile.js";
import { getRequest, portOpen } from "./http.js";
import { assertTestPath } from "./paths.js";

export interface ExitInfo {
  code: number | null;
  signal: string | null;
}

export interface ZoteroProcess {
  child: ChildProcess;
  pid: number;
  args: string[];
  logFile: string;
  startedAt: number;
  exited: Promise<ExitInfo>;
  exitInfo: ExitInfo | null;
}

export function launchZotero(exe: string, layout: RunLayout, options: { debugOutput: boolean }): ZoteroProcess {
  const profileDir = assertTestPath(layout.profileDir, "profile directory");
  const dataDir = assertTestPath(layout.dataDir, "data directory");
  if (!fs.existsSync(exe)) throw new Error(`Zotero executable not found: ${exe}`);
  // -datadir sets Zotero.forceDataDir, which also skips DataDirectory.checkForMigration() entirely.
  // zotero.exe is Gecko's launcher process: without -wait-for-browser it starts the real Zotero process
  // as a child and exits at once, so the spawned PID would not track the instance's lifetime.
  const args = ["-profile", profileDir, "-no-remote", "-wait-for-browser", "-datadir", dataDir];
  if (options.debugOutput) args.push("-ZoteroDebugText");
  const logFile = path.join(layout.logsDir, "zotero-stdout.log");
  const log = fs.openSync(logFile, "a");
  const env: NodeJS.ProcessEnv = { ...process.env, MOZ_NO_REMOTE: "1", MOZ_CRASHREPORTER_DISABLE: "1" };
  // Never let an inherited profile override reach the child.
  for (const name of ["XRE_PROFILE_PATH", "XRE_PROFILE_LOCAL_PATH", "XRE_PROFILE_NAME", "MOZ_RESET_PROFILE_RESTART"]) {
    delete env[name];
  }
  const child = spawn(exe, args, { stdio: ["ignore", log, log], env, windowsHide: false });
  fs.closeSync(log);
  if (child.pid === undefined) throw new Error("Failed to spawn Zotero");
  const proc: ZoteroProcess = {
    child,
    pid: child.pid,
    args,
    logFile,
    startedAt: Date.now(),
    exitInfo: null,
    exited: new Promise<ExitInfo>((resolve) => {
      child.once("exit", (code, signal) => {
        proc.exitInfo = { code, signal };
        resolve(proc.exitInfo);
      });
    }),
  };
  return proc;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until the test port answers /connector/ping (Zotero's HTTP server is up). */
export async function waitForServer(proc: ZoteroProcess, port: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitInfo) throw new Error(`Zotero exited during startup (code ${proc.exitInfo.code})`);
    if (await portOpen(port, 500)) {
      const ping = await getRequest(port, "/connector/ping");
      if (ping.response?.status === 200) return Date.now() - proc.startedAt;
    }
    await delay(500);
  }
  throw new Error(`Zotero did not answer on port ${port} within ${timeoutMs} ms`);
}

export function runPowerShell(script: string, timeoutMs = 60000): Promise<string> {
  // Progress records would otherwise arrive on stderr as CLIXML noise.
  const encoded = Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n${script}`, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`PowerShell failed: ${error.message}\n${stderr}`));
        else resolve(stdout);
      },
    );
  });
}

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
  created: string;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Every process on the machine; the creation time tells a reused PID apart from the original process. */
export async function allProcesses(): Promise<ProcessInfo[]> {
  const out = await runPowerShell(
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{n='Created';e={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress",
  );
  return asArray(JSON.parse(out || "[]") as any).map(
    (p: any): ProcessInfo => ({ pid: p.ProcessId, parentPid: p.ParentProcessId, name: p.Name, created: p.Created }),
  );
}

/** Command line of one process (evidence that the instance really got -profile/-no-remote). */
export async function processCommandLine(pid: number): Promise<string | null> {
  const out = await runPowerShell(
    `$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8\n` +
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}").CommandLine`,
  );
  return out.trim() || null;
}

/** The launched process and all of its descendants. */
export async function processTree(rootPid: number): Promise<ProcessInfo[]> {
  const all = await allProcesses();
  const tree: ProcessInfo[] = [];
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const self = all.find((p) => p.pid === pid);
    if (self) tree.push(self);
    for (const child of all.filter((p) => p.parentPid === pid && p.pid !== pid)) queue.push(child.pid);
  }
  return tree;
}

export interface Listener {
  address: string;
  port: number;
  pid: number;
}

export async function tcpListeners(port: number): Promise<Listener[]> {
  const out = await runPowerShell(
    // "No matching connection" is an ObjectNotFound error (non-zero exit); any other error must surface.
    `try { Get-NetTCPConnection -State Listen -LocalPort ${Math.trunc(port)} -ErrorAction Stop | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress } ` +
      `catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw } }\nexit 0`,
  );
  return asArray(JSON.parse(out.trim() || "null") as any).map(
    (l: any): Listener => ({ address: l.LocalAddress, port: l.LocalPort, pid: l.OwningProcess }),
  );
}

export interface WindowInfo {
  pid: number;
  className: string;
  title: string;
}

const ENUM_WINDOWS_TYPE = `
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ZabWindows {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public static List<string> List(uint[] pids) {
    var wanted = new HashSet<uint>(pids);
    var result = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (wanted.Contains(pid) && IsWindowVisible(h)) {
        var title = new StringBuilder(512); GetWindowText(h, title, 512);
        var cls = new StringBuilder(256); GetClassName(h, cls, 256);
        result.Add(pid + "\\t" + cls + "\\t" + title);
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}`;

/** Visible top-level windows owned by the given processes (startup modals show up here). */
export async function visibleWindows(pids: number[]): Promise<WindowInfo[]> {
  if (!pids.length) return [];
  const script =
    `$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8\n` +
    `Add-Type -TypeDefinition @"\n${ENUM_WINDOWS_TYPE}\n"@\n` +
    `[ZabWindows]::List([uint32[]]@(${pids.join(",")})) | ForEach-Object { $_ }`;
  const out = await runPowerShell(script);
  return out
    .split(/\r?\n/)
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [pid, className, ...title] = line.split("\t");
      return { pid: Number(pid), className: className ?? "", title: title.join("\t") };
    });
}

export interface StopResult {
  graceful: boolean;
  exit: ExitInfo | null;
  forcedPids: number[];
  leftovers: ProcessInfo[];
  ms: number;
}

/**
 * Stop the test instance: wait for the quit the caller already requested, else terminate the launched
 * process tree (taskkill /T on our PID only), then verify none of the recorded tree survived.
 */
export async function stopZotero(proc: ZoteroProcess, recordedTree: ProcessInfo[], graceMs: number): Promise<StopResult> {
  const started = Date.now();
  const exitedInTime = await Promise.race([proc.exited.then(() => true), delay(graceMs).then(() => false)]);
  const forcedPids: number[] = [];
  if (!exitedInTime) {
    forcedPids.push(proc.pid);
    await new Promise<void>((resolve) => {
      execFile("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
    await Promise.race([proc.exited, delay(15000)]);
  }
  // Descendants that outlived the root (e.g. orphaned helpers): only kill exact PID + creation-time matches.
  await delay(1000);
  const allNow = await allProcesses();
  const leftovers = recordedTree.filter((p) => allNow.some((q) => q.pid === p.pid && q.created === p.created));
  for (const p of leftovers) {
    forcedPids.push(p.pid);
    await new Promise<void>((resolve) => {
      execFile("taskkill.exe", ["/PID", String(p.pid), "/F"], { windowsHide: true }, () => resolve());
    });
  }
  return { graceful: exitedInTime, exit: proc.exitInfo, forcedPids, leftovers, ms: Date.now() - started };
}
