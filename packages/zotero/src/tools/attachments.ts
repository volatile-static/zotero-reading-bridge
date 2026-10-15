/**
 * Attachment files and Zotero directories (Zotero sandbox only): list_attachments, get_attachment_path,
 * get_library_paths. Paths only; file contents are never read and missing files are never downloaded.
 */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import { attachmentPathInfo, storageDirectory } from "../zotero/attachments.js";
import { getItemByKey, type ZItem } from "../zotero/library.js";
import { itemKind, itemsByID, loadLibrary, wrongItemType } from "../zotero/lookup.js";
import { safe } from "../zotero/refs.js";
import { requireKey } from "./data-args.js";
import { paginateMapped, parsePageArgs } from "./pagination.js";
import { json, ToolError, type ToolArgs, type ToolHandler, type ToolOutput } from "./types.js";

interface LibraryPaths {
  /** Zotero data directory (Settings > Advanced > Files and Folders). */
  dataDirectory: string | null;
  /** Folder holding stored attachments as storage/<ITEM KEY>/<file>. */
  storageDirectory: string | null;
  /** Main SQLite database (zotero.sqlite); Zotero keeps it locked while running. */
  database: string | null;
  /** Base directory for linked files saved with relative paths; null when not configured. */
  linkedAttachmentBaseDirectory: string | null;
}

async function listAttachments(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const lib = await loadLibrary(args.libraryID);
  const item = await getItemByKey(lib, requireKey(args));
  let attachments: ZItem[];
  switch (itemKind(item)) {
    case "attachment":
      attachments = [item];
      break;
    case "regular":
      attachments = itemsByID(safe(() => item.getAttachments(false), [] as number[]));
      break;
    default:
      throw wrongItemType(item, "a regular item or an attachment");
  }
  return json(await paginateMapped(attachments, page, attachmentPathInfo));
}

async function getAttachmentPath(args: ToolArgs): Promise<ToolOutput> {
  const lib = await loadLibrary(args.libraryID);
  const item = await getItemByKey(lib, requireKey(args));
  switch (itemKind(item)) {
    case "attachment":
      return json(await attachmentPathInfo(item));
    case "regular": {
      // Zotero's own pick (item.js getBestAttachments): PDFs first, preferring a URL match with the parent, then
      // the oldest; trashed attachments and linked URLs are never chosen.
      const best = await item.getBestAttachment();
      if (!best) {
        throw new ToolError("NOT_FOUND", `Item ${item.key} has no file attachment`, {
          libraryID: item.libraryID,
          key: item.key,
          attachmentCount: safe(() => item.getAttachments(false).length, 0),
        });
      }
      return json(await attachmentPathInfo(best));
    }
    default:
      throw wrongItemType(item, "an attachment or a regular item");
  }
}

async function getLibraryPaths(): Promise<ToolOutput> {
  const paths: LibraryPaths = {
    dataDirectory: safe(() => Zotero.DataDirectory.dir, null),
    storageDirectory: storageDirectory(),
    database: safe(() => (Zotero.DataDirectory as unknown as { getDatabase(): string }).getDatabase(), null),
    linkedAttachmentBaseDirectory: safe(() => {
      const base = Zotero.Prefs.get("baseAttachmentPath");
      return typeof base === "string" && base !== "" ? base : null;
    }, null),
  };
  return json(paths);
}

export const attachmentHandlers = {
  list_attachments: listAttachments,
  get_attachment_path: getAttachmentPath,
  get_library_paths: getLibraryPaths,
} satisfies Partial<Record<ToolName, ToolHandler>>;
