/**
 * Attachment serialization and file-path resolution (Zotero sandbox only).
 * Never downloads, opens or reads attachment files: only Zotero's path resolution and an existence check.
 */
import type { AttachmentLinkMode, AttachmentPathInfo, AttachmentSummary } from "../../../../shared/types/tools.js";
import type { ZItem } from "./library.js";
import { itemRef, safe } from "./refs.js";

const STORED_MODES: ReadonlySet<AttachmentLinkMode> = new Set(["imported_file", "imported_url", "embedded_image"]);

/** Zotero.Sync.Storage.Local.SYNC_STATE_TO_DOWNLOAD / SYNC_STATE_FORCE_DOWNLOAD (xpcom/storage/storageLocal.js). */
const PENDING_DOWNLOAD_STATES = new Set([1, 4]);

/**
 * <dataDir>/storage, or <dataDir>/storage/<KEY> for one attachment. Computed like
 * Zotero.Attachments.getStorageDirectoryByLibraryAndKey, minus Zotero.getStorageDirectory()'s
 * create-if-missing side effect.
 */
export function storageDirectory(key?: string): string | null {
  return safe(() => {
    const root = PathUtils.join(Zotero.DataDirectory.dir, "storage");
    return key === undefined ? root : PathUtils.join(root, key);
  }, null);
}

export function linkModeName(attachment: ZItem): AttachmentLinkMode {
  return safe(
    () => Zotero.Attachments.linkModeToName(attachment.attachmentLinkMode as number) as AttachmentLinkMode,
    "unknown",
  );
}

export function attachmentSummary(attachment: ZItem): AttachmentSummary {
  const linkMode = linkModeName(attachment);
  return {
    ...itemRef(attachment),
    parentKey: safe(() => (attachment.parentKey as string | false) || null, null),
    contentType: safe(() => attachment.attachmentContentType || null, null),
    linkMode,
    filename: linkMode === "linked_url" ? null : safe(() => attachment.attachmentFilename || null, null),
  };
}

async function settle<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

function missingFileNote(attachment: ZItem, linkMode: AttachmentLinkMode, rawPath: string, path: string | null): string {
  if (path === null) {
    if (linkMode === "linked_file" && rawPath.startsWith("attachments:")) {
      return "This linked file is stored relative to the linked attachment base directory, which is not set in Zotero's settings (Files and Folders), so its path cannot be resolved.";
    }
    return "Zotero could not resolve a file path for this attachment.";
  }
  if (STORED_MODES.has(linkMode)) {
    const syncState = safe(() => Number(attachment.attachmentSyncState), -1);
    if (PENDING_DOWNLOAD_STATES.has(syncState)) {
      return "The file has not been downloaded to this computer yet (it was synced from another device). Open the attachment in Zotero to sync it; this path lookup does not download it.";
    }
    return "The file is missing from Zotero's storage directory on this computer (not synced here, or deleted).";
  }
  return "The linked file was not found at its recorded location (it may have been moved or renamed, or be on a drive that is not connected).";
}

/**
 * Resolved path and existence of an attachment's file. `path` is the location Zotero resolves even when the file
 * is missing (so the user can be told where it should be); `exists` says whether it is there now.
 */
export async function attachmentPathInfo(attachment: ZItem): Promise<AttachmentPathInfo> {
  const summary = attachmentSummary(attachment);
  const linkMode = summary.linkMode;
  const base = { ...summary, path: null, exists: false, url: null, storageDirectory: null };

  if (linkMode === "linked_url") {
    const url = safe(() => attachment.getField("url"), "") || null;
    return { ...base, url, note: "Linked URL attachment: there is no local file; use url." };
  }
  if (linkMode === "unknown") {
    return { ...base, note: "Unrecognized attachment link mode; no file path is available." };
  }

  const located = { ...base, storageDirectory: STORED_MODES.has(linkMode) ? storageDirectory(attachment.key) : null };
  const rawPath = safe(() => attachment.attachmentPath || "", "");
  if (!rawPath) {
    return { ...located, note: "Zotero has no file path recorded for this attachment." };
  }
  if (rawPath.startsWith("AAAA")) {
    // Legacy macOS alias record: Zotero's path getters rewrite it in the database when resolving, so skip them.
    return {
      ...located,
      note: "This attachment uses a legacy macOS alias path. Open it once in Zotero so Zotero converts the path, then retry.",
    };
  }

  // getFilePathAsync() resolves only when the file exists; getFilePath() gives the expected location otherwise.
  const existing = await settle(() => attachment.getFilePathAsync(), false as string | false);
  const path = existing || safe(() => attachment.getFilePath(), false as string | false) || null;
  const exists = existing !== false;
  return {
    ...located,
    path,
    exists,
    note: exists ? null : missingFileNote(attachment, linkMode, rawPath, path),
  };
}
