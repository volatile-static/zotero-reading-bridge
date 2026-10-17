/**
 * Attachment files and Zotero directories (Zotero sandbox only): list_attachments, get_attachment_path,
 * get_fulltext, get_library_paths. Attachment files themselves are never read (paths only) and missing files are
 * never downloaded; get_fulltext returns the text Zotero already extracted into its full-text cache.
 */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import { FULLTEXT_LIMITS, type FulltextInfo } from "../../../../shared/types/tools.js";
import { attachmentPathInfo, attachmentSummary, storageDirectory } from "../zotero/attachments.js";
import { extractedText } from "../zotero/fulltext.js";
import { getItemByKey, type ZItem } from "../zotero/library.js";
import { itemKind, itemsByID, loadLibrary, wrongItemType } from "../zotero/lookup.js";
import { safe } from "../zotero/refs.js";
import { intArg, requireKey } from "./data-args.js";
import { sliceEnd } from "./fulltext-slice.js";
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

/** The attachment `key` names, or for a regular item its best attachment. */
async function resolveAttachment(args: ToolArgs): Promise<ZItem> {
  const lib = await loadLibrary(args.libraryID);
  const item = await getItemByKey(lib, requireKey(args));
  switch (itemKind(item)) {
    case "attachment":
      return item;
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
      return best;
    }
    default:
      throw wrongItemType(item, "an attachment or a regular item");
  }
}

async function getAttachmentPath(args: ToolArgs): Promise<ToolOutput> {
  return json(await attachmentPathInfo(await resolveAttachment(args)));
}

function fulltextNote(info: Omit<FulltextInfo, "note">): string | null {
  const readFile = "Use get_attachment_path and read the file itself";
  if (info.totalChars === 0) {
    if (info.linkMode === "linked_url") return "Linked URL attachment: Zotero keeps no text for it.";
    switch (info.indexState) {
      case "queued":
        return `Zotero has not processed this attachment's synced full text yet. ${readFile}.`;
      case "unindexed":
        return `Zotero has not indexed this attachment (Zotero indexes PDF, EPUB and web-page attachments when they are added; the item's context menu offers Reindex Item). ${readFile}.`;
      default:
        return `Zotero has no extracted text for this attachment (for example a scanned PDF without a text layer, or a file type Zotero does not index). ${readFile}.`;
    }
  }
  if (info.indexState === "partial") {
    const pages =
      info.indexedPages !== null && info.totalPages !== null ? ` (${info.indexedPages} of ${info.totalPages} pages)` : "";
    return `Zotero indexed only part of this document${pages}, limited by its full-text settings (extensions.zotero.fulltext.pdfMaxPages / textMaxLength); this text is not the whole document. ${readFile} for the rest.`;
  }
  return null;
}

async function getFulltext(args: ToolArgs): Promise<ToolOutput> {
  const attachment = await resolveAttachment(args);
  const extracted = await extractedText(attachment);
  const all = extracted.text ?? "";
  const offset = intArg(args, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
  if (offset > 0 && offset >= all.length) {
    throw new ToolError("INVALID_ARGUMENT", `offset ${offset} is past the end of the text (${all.length} characters)`, {
      totalChars: all.length,
    });
  }
  const explicit = args.maxLength === undefined ? null : intArg(args, "maxLength", FULLTEXT_LIMITS.maxLength, FULLTEXT_LIMITS.minLength, FULLTEXT_LIMITS.maxLength);
  const end = all.length === 0 ? 0 : sliceEnd(all, offset, { maxChars: explicit, maxTokens: FULLTEXT_LIMITS.defaultTokenBudget });
  const parent = safe(() => attachment.parentItem, undefined);
  const info: Omit<FulltextInfo, "note"> = {
    ...attachmentSummary(attachment),
    parentTitle: parent ? safe(() => parent.getDisplayTitle(), "") || null : null,
    indexState: extracted.indexState,
    source: extracted.source,
    indexedPages: extracted.indexedPages,
    totalPages: extracted.totalPages,
    totalChars: all.length,
    offset,
    returnedChars: end - offset,
    complete: end >= all.length,
    nextOffset: end < all.length ? end : null,
    text: end > offset,
  };
  const result: FulltextInfo = { ...info, note: fulltextNote(info) };
  // The text goes in its own content item: inside the JSON every line break and quote would be escaped.
  return json(result, end > offset ? [{ type: "text", text: all.slice(offset, end) }] : []);
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
  get_fulltext: getFulltext,
  get_library_paths: getLibraryPaths,
} satisfies Partial<Record<ToolName, ToolHandler>>;
