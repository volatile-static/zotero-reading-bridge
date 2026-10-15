/**
 * Harness side of the seed plugin's /zab-test/* endpoints (token-authenticated JSON over the test port).
 */
import type { SeedManifest } from "../fixtures/data.js";
import {
  SEED_PATHS,
  SEED_TOKEN_HEADER,
  type AddonRequest,
  type AddonResult,
  type FingerprintResult,
  type FixtureQueryResult,
  type PrefRequest,
  type PrefResult,
  type PrefsPaneRequest,
  type PrefsPaneResult,
  type SeedRequest,
  type SeedResult,
  type SeedStateResult,
  type TagRequest,
  type TagResult,
  type UiAction,
  type UiResult,
} from "../seed-api.js";
import { postJson, type RawResult } from "./http.js";

export class SeedClient {
  constructor(
    readonly port: number,
    private readonly token: string,
  ) {}

  /** POST with an explicit token (or none) and return the raw result; used by the token cases. */
  raw(path: string, body: unknown, token: string | null): Promise<RawResult> {
    return postJson(this.port, path, body, {
      extraHeaders: token === null ? [] : [[SEED_TOKEN_HEADER, token]],
      timeoutMs: 120000,
    });
  }

  async call<T>(path: string, body: unknown): Promise<T> {
    const result = await this.raw(path, body, this.token);
    if (!result.response) {
      throw new Error(`Seed ${path}: no HTTP response (${result.dropped ? "connection dropped" : result.error})`);
    }
    let payload: { ok?: boolean; error?: string };
    try {
      payload = JSON.parse(result.response.body) as { ok?: boolean; error?: string };
    } catch {
      throw new Error(`Seed ${path}: HTTP ${result.response.status} with non-JSON body ${result.response.body.slice(0, 200)}`);
    }
    if (result.response.status !== 200 || payload.ok !== true) {
      throw new Error(`Seed ${path}: HTTP ${result.response.status}: ${payload.error ?? result.response.body.slice(0, 500)}`);
    }
    return payload as T;
  }

  state(): Promise<SeedStateResult> {
    return this.call(SEED_PATHS.state, {});
  }

  seed(request: SeedRequest): Promise<SeedResult> {
    return this.call(SEED_PATHS.seed, request);
  }

  query(manifest: SeedManifest): Promise<FixtureQueryResult> {
    return this.call(SEED_PATHS.query, { manifest });
  }

  fingerprint(files: string[]): Promise<FingerprintResult> {
    return this.call(SEED_PATHS.fingerprint, { files });
  }

  ui(action: UiAction): Promise<UiResult> {
    return this.call(SEED_PATHS.ui, action);
  }

  pref(request: PrefRequest): Promise<PrefResult> {
    return this.call(SEED_PATHS.pref, request);
  }

  tag(request: TagRequest): Promise<TagResult> {
    return this.call(SEED_PATHS.tag, request);
  }

  addon(request: AddonRequest): Promise<AddonResult> {
    return this.call(SEED_PATHS.addon, request);
  }

  prefsPane(request: PrefsPaneRequest): Promise<PrefsPaneResult> {
    return this.call(SEED_PATHS.prefsPane, request);
  }

  quit(): Promise<{ ok: true }> {
    return this.call(SEED_PATHS.quit, {});
  }
}
