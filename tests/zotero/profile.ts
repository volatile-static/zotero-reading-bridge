/**
 * Isolated Zotero profile + data directory for one harness run, and fingerprints of the user's real
 * Zotero files so the run can prove it left them untouched.
 *
 * Layout (all under work/zotero-test/<runId>/):
 *   profile/            Gecko profile passed with -profile (user.js, extensions/<id>.xpi)
 *   data/               Zotero data directory (extensions.zotero.dataDir + -datadir)
 *   fixtures/           synthetic attachment files (PDF copies, Chinese + space paths)
 *   addons/             built seed XPI
 *   logs/               Zotero stdout/stderr
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SEED_PREF_DATA_DIR, SEED_PREF_TOKEN } from "./seed-api.js";
import { TEST_PORT, TEST_ROOT, assertTestPath, realZoteroLocations } from "./lib/paths.js";

export interface RunLayout {
  runId: string;
  runDir: string;
  profileDir: string;
  dataDir: string;
  fixturesDir: string;
  addonsDir: string;
  logsDir: string;
  token: string;
}

function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function createRunLayout(): RunLayout {
  const runId = `${timestamp()}-${randomBytes(3).toString("hex")}`;
  const runDir = assertTestPath(path.join(TEST_ROOT, runId), "run directory");
  const layout: RunLayout = {
    runId,
    runDir,
    profileDir: assertTestPath(path.join(runDir, "profile"), "profile directory"),
    dataDir: assertTestPath(path.join(runDir, "data"), "data directory"),
    fixturesDir: assertTestPath(path.join(runDir, "fixtures"), "fixture directory"),
    addonsDir: assertTestPath(path.join(runDir, "addons"), "add-on directory"),
    logsDir: assertTestPath(path.join(runDir, "logs"), "log directory"),
    token: randomBytes(24).toString("hex"),
  };
  if (fs.existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);
  for (const dir of [layout.profileDir, layout.dataDir, layout.fixturesDir, layout.addonsDir, layout.logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return layout;
}

type PrefValue = string | number | boolean;

/**
 * Prefs for the throwaway profile. Names verified against Zotero 11.0-beta.1
 * defaults/preferences/zotero.js, xpcom/dataDirectory.js, zoteroPane.js, Gecko XPIProvider/XPIDatabase and
 * the bundled word-processor plugin installers.
 */
export function testProfilePrefs(layout: RunLayout, port = TEST_PORT): Record<string, PrefValue> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    // Zotero's HTTP server on the test port (the user's Zotero keeps 23119).
    "extensions.zotero.httpServer.enabled": true,
    "extensions.zotero.httpServer.port": port,
    // Custom data directory; useDataDir=true also makes DataDirectory.canMigrate() false (no migration).
    "extensions.zotero.dataDir": layout.dataDir,
    "extensions.zotero.useDataDir": true,
    "extensions.zotero.warnOnUnsafeDataDir": false,
    // First-run start page (network) and guidance popups.
    "extensions.zotero.firstRun2": false,
    "extensions.zotero.firstRunGuidance": false,
    // Background network activity that is irrelevant to the test.
    "extensions.zotero.automaticScraperUpdates": false,
    "extensions.zotero.retractions.enabled": false,
    "extensions.zotero.sync.autoSync": false,
    "extensions.zotero.reportTranslationFailure": false,
    // The Word/LibreOffice integrations would otherwise copy Zotero.dotm into the REAL user's Word
    // STARTUP folder (or prompt) on first run of a fresh profile.
    "extensions.zoteroWinWordIntegration.skipInstallation": true,
    "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
    // Load add-ons dropped into <profile>/extensions without the side-load consent prompt, and only from
    // the profile and application scopes (never from user/system-wide side-load locations).
    "extensions.autoDisableScopes": 0,
    "extensions.enabledScopes": 5,
    "extensions.update.enabled": false,
    "extensions.update.autoUpdateDefault": false,
    // No application update checks or prompts during the run.
    "app.update.auto": false,
    "app.update.interval": 31536000,
    "app.update.lastUpdateTime.background-update-timer": nowSeconds,
    // A killed test instance must never trigger the safe-mode prompt on a later launch.
    "toolkit.startup.max_resumed_crashes": -1,
    // Harness-only prefs read by the seed plugin.
    [SEED_PREF_TOKEN]: layout.token,
    [SEED_PREF_DATA_DIR]: layout.dataDir,
  };
}

export function writeUserJs(layout: RunLayout, prefs: Record<string, PrefValue>): string {
  const file = assertTestPath(path.join(layout.profileDir, "user.js"), "user.js");
  const lines = Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`);
  fs.writeFileSync(file, `// Generated by tests/zotero/profile.ts for harness run ${layout.runId}\n${lines.join("\n")}\n`, "utf8");
  return file;
}

/** Install an XPI the way a side-loaded add-on is discovered: <profile>/extensions/<addon id>.xpi. */
export function installAddon(layout: RunLayout, addonId: string, xpiPath: string): string {
  const target = assertTestPath(path.join(layout.profileDir, "extensions", `${addonId}.xpi`), "add-on install path");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(xpiPath, target);
  return target;
}

export interface FileStamp {
  path: string;
  exists: boolean;
  sha256: string | null;
  size: number | null;
  mtimeMs: number | null;
}

export interface RealProfileState {
  files: FileStamp[];
}

/** Hash small files; stat-only for large ones (the real zotero.sqlite is never read). */
function stampFile(file: string, hash: boolean): FileStamp {
  try {
    const stat = fs.statSync(file);
    return {
      path: file,
      exists: true,
      sha256: hash ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return { path: file, exists: false, sha256: null, size: null, mtimeMs: null };
  }
}

/** Profile directories listed in the real profiles.ini (IsRelative resolved against its folder). */
function realProfileDirs(profilesIni: string): string[] {
  if (!fs.existsSync(profilesIni)) return [];
  const dirs: string[] = [];
  let relative = true;
  let current: string | null = null;
  const flush = () => {
    if (current) dirs.push(relative ? path.join(path.dirname(profilesIni), current) : current);
    current = null;
    relative = true;
  };
  for (const line of fs.readFileSync(profilesIni, "utf8").split(/\r?\n/)) {
    if (line.startsWith("[")) flush();
    const match = /^(Path|IsRelative)=(.*)$/.exec(line.trim());
    if (match?.[1] === "Path") current = match[2] ?? null;
    if (match?.[1] === "IsRelative") relative = match[2] === "1";
  }
  flush();
  return dirs;
}

export function captureRealProfileState(): RealProfileState {
  const real = realZoteroLocations();
  const files: FileStamp[] = [
    stampFile(real.profilesIni, true),
    stampFile(path.join(real.appDataDir, "installs.ini"), true),
  ];
  for (const dir of realProfileDirs(real.profilesIni)) {
    files.push(stampFile(path.join(dir, "prefs.js"), true));
    files.push(stampFile(path.join(dir, "extensions.json"), true));
  }
  files.push(stampFile(path.join(real.dataDir, "zotero.sqlite"), false));
  const appData = path.dirname(path.dirname(real.appDataDir));
  files.push(stampFile(path.join(appData, "Microsoft", "Word", "STARTUP", "Zotero.dotm"), false));
  return { files };
}

export function diffRealProfileState(before: RealProfileState, after: RealProfileState): string[] {
  const diffs: string[] = [];
  for (const old of before.files) {
    const now = after.files.find((f) => f.path === old.path);
    if (!now) {
      diffs.push(`${old.path}: no longer tracked`);
      continue;
    }
    for (const field of ["exists", "sha256", "size", "mtimeMs"] as const) {
      if (old[field] !== now[field]) diffs.push(`${old.path}: ${field} ${String(old[field])} -> ${String(now[field])}`);
    }
  }
  return diffs;
}
