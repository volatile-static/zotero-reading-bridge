/**
 * Test-only HTTP endpoints under /zab-test/* on Zotero's built-in server.
 *
 * Registered only when the profile carries a per-run token and the active data directory is the one the
 * harness created under work/zotero-test (see checkTestEnvironment), so the plugin is inert anywhere else.
 */
import type { SeedManifest } from "../../fixtures/data.js";
import {
  SEED_PATHS,
  SEED_PREF_DATA_DIR,
  SEED_PREF_TOKEN,
  SEED_TOKEN_HEADER,
  SEED_TOKEN_MIN_LENGTH,
  type AddonRequest,
  type PrefRequest,
  type PrefsPaneRequest,
  type SeedRequest,
  type TagRequest,
  type UiAction,
} from "../../seed-api.js";
import { controlAddon, scheduleQuit, seedState, setPref, setTag } from "./control.js";
import { fingerprint } from "./fingerprint.js";
import { prefsPane } from "./prefs-pane.js";
import { queryFixtures } from "./query.js";
import { seedFixtures } from "./seed.js";
import { runUiAction } from "./ui.js";
import { errorMessage, jsonResponse, pathKey, type EndpointResponse } from "./util.js";

const LOG_PREFIX = "[zab-test-seed]";
const TEST_ROOT_MARKER = "/work/zotero-test/";

let expectedToken: string | null = null;

/** Returns a refusal reason, or null when this profile is a harness test profile. */
export function checkTestEnvironment(): string | null {
  const token = Zotero.Prefs.get(SEED_PREF_TOKEN, true);
  if (typeof token !== "string" || !new RegExp(`^[0-9a-f]{${SEED_TOKEN_MIN_LENGTH},}$`).test(token)) {
    return `missing or malformed ${SEED_PREF_TOKEN}`;
  }
  const expectedDataDir = Zotero.Prefs.get(SEED_PREF_DATA_DIR, true);
  if (typeof expectedDataDir !== "string" || !pathKey(expectedDataDir).includes(TEST_ROOT_MARKER)) {
    return `${SEED_PREF_DATA_DIR} is not a harness directory`;
  }
  if (pathKey(Zotero.DataDirectory.dir) !== pathKey(expectedDataDir)) {
    return "active data directory differs from the harness data directory";
  }
  expectedToken = token;
  return null;
}

type Handler = (body: any) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  [SEED_PATHS.state]: () => seedState(),
  [SEED_PATHS.seed]: async (body: SeedRequest) => {
    const started = Date.now();
    const manifest = await seedFixtures(body);
    return { ok: true, manifest, ms: Date.now() - started };
  },
  [SEED_PATHS.query]: (body: { manifest: SeedManifest }) => queryFixtures(body.manifest),
  [SEED_PATHS.fingerprint]: (body: { files?: string[] }) => fingerprint(body.files ?? []),
  [SEED_PATHS.ui]: (body: UiAction) => runUiAction(body),
  [SEED_PATHS.pref]: (body: PrefRequest) => setPref(body),
  [SEED_PATHS.addon]: (body: AddonRequest) => controlAddon(body),
  [SEED_PATHS.prefsPane]: (body: PrefsPaneRequest) => prefsPane(body),
  [SEED_PATHS.tag]: (body: TagRequest) => setTag(body),
  [SEED_PATHS.quit]: async () => {
    scheduleQuit();
    return { ok: true };
  },
};

interface ZoteroRequest {
  method: string;
  pathname: string;
  headers: Record<string, string | undefined>;
  data: unknown;
}

class SeedEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];

  // Zotero picks the request-object calling convention by init.length, so exactly one parameter.
  async init(request: ZoteroRequest): Promise<EndpointResponse> {
    try {
      if (!expectedToken || request.headers[SEED_TOKEN_HEADER] !== expectedToken) {
        return jsonResponse(403, { ok: false, error: "missing or wrong test token" });
      }
      const handler = HANDLERS[request.pathname];
      if (!handler) return jsonResponse(404, { ok: false, error: `unknown seed path ${request.pathname}` });
      return jsonResponse(200, await handler(request.data ?? {}));
    } catch (error) {
      Zotero.debug(`${LOG_PREFIX} ${request.pathname} failed: ${errorMessage(error)}`);
      return jsonResponse(500, { ok: false, error: errorMessage(error), stack: error instanceof Error ? error.stack : null });
    }
  }
}

export function registerSeedEndpoints(): boolean {
  const refusal = checkTestEnvironment();
  if (refusal) {
    Zotero.debug(`${LOG_PREFIX} not registering test endpoints: ${refusal}`);
    return false;
  }
  for (const path of Object.values(SEED_PATHS)) {
    Zotero.Server.Endpoints[path] = SeedEndpoint as any;
  }
  Zotero.debug(`${LOG_PREFIX} registered ${Object.values(SEED_PATHS).length} test endpoints`);
  return true;
}

export function unregisterSeedEndpoints(): void {
  for (const path of Object.values(SEED_PATHS)) {
    if ((Zotero.Server.Endpoints[path] as unknown) === SeedEndpoint) delete Zotero.Server.Endpoints[path];
  }
  expectedToken = null;
}
