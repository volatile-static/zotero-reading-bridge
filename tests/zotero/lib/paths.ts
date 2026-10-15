/**
 * Locations and safety checks for the live harness. Everything the harness creates, deletes or lets
 * Zotero write must resolve inside TEST_ROOT (work/zotero-test); the user's real Zotero profile and data
 * directory are only ever read (fingerprinted).
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const WORK_ROOT = path.join(REPO_ROOT, "work");
export const TEST_ROOT = path.join(WORK_ROOT, "zotero-test");
export const REPORT_PATH = path.join(TEST_ROOT, "report.json");
/** The release XPI from `npm run build`; ZAB_BRIDGE_XPI points the harness at another candidate build. */
export const BRIDGE_XPI = path.resolve(process.env.ZAB_BRIDGE_XPI ?? path.join(REPO_ROOT, "outputs", "zotero-ai-bridge.xpi"));
export const SEED_PLUGIN_DIR = path.join(REPO_ROOT, "tests", "zotero", "seed-plugin");

export const ZOTERO_EXE = process.env.ZAB_ZOTERO_EXE ?? "C:/Program Files/Zotero/zotero.exe";
/** Test port, distinct from the user's Zotero (23119) so both can run side by side. */
export const TEST_PORT = 23139;
export const REAL_ZOTERO_PORT = 23119;

/** The user's real Zotero locations (read-only for the harness). */
export function realZoteroLocations(): { appDataDir: string; profilesIni: string; dataDir: string } {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  const appDataDir = path.join(appData, "Zotero", "Zotero");
  return {
    appDataDir,
    profilesIni: path.join(appDataDir, "profiles.ini"),
    dataDir: path.join(os.homedir(), "Zotero"),
  };
}

function comparable(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True when `child` is strictly inside `parent` (after resolution; case-insensitive on Windows). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(comparable(parent), comparable(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Throws unless `p` is inside TEST_ROOT and outside every real Zotero location. */
export function assertTestPath(p: string, what: string): string {
  const resolved = path.resolve(p);
  if (!isInside(TEST_ROOT, resolved)) {
    throw new Error(`Refusing to use ${what} outside ${TEST_ROOT}: ${resolved}`);
  }
  const real = realZoteroLocations();
  for (const forbidden of [real.appDataDir, real.dataDir]) {
    if (comparable(resolved) === comparable(forbidden) || isInside(forbidden, resolved)) {
      throw new Error(`Refusing to use ${what} inside the real Zotero location ${forbidden}`);
    }
  }
  return resolved;
}
