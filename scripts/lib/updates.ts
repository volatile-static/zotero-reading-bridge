import { ZOTERO_ADDON_ID } from "../../shared/types/bridge.js";
import { sha256 } from "./files.js";
import { OUTPUT_NAMES } from "./layout.js";
import { isRecord } from "./manifests.js";

const RELEASES = "https://github.com/volatile-static/zotero-reading-bridge/releases";
export const ZOTERO_UPDATE_URL = `${RELEASES}/latest/download/updates.json`;

/** Bind each update to the exact release asset and its bytes, never a moving latest XPI. */
export function createUpdateManifest(manifest: Record<string, unknown>, xpi: Buffer, tag?: string) {
  const version = manifest["version"];
  const applications = manifest["applications"];
  const zotero = isRecord(applications) ? applications["zotero"] : undefined;
  if (typeof version !== "string" || !isRecord(zotero)
    || zotero["id"] !== ZOTERO_ADDON_ID || zotero["update_url"] !== ZOTERO_UPDATE_URL
    || typeof zotero["strict_min_version"] !== "string" || typeof zotero["strict_max_version"] !== "string") {
    throw new Error("Invalid Zotero manifest for update generation");
  }
  const releaseTag = tag ?? `v${version}`;
  if (releaseTag !== version && releaseTag !== `v${version}`) throw new Error("Release tag must match the XPI version");
  return {
    addons: {
      [ZOTERO_ADDON_ID]: {
        updates: [{
          version,
          update_link: `${RELEASES}/download/${encodeURIComponent(releaseTag)}/${OUTPUT_NAMES.xpi}`,
          update_hash: `sha256:${sha256(xpi)}`,
          applications: { zotero: {
            strict_min_version: zotero["strict_min_version"],
            strict_max_version: zotero["strict_max_version"],
          } },
        }],
      },
    },
  };
}
