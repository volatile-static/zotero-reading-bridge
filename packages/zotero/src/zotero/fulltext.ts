/**
 * Read the text Zotero already extracted for an attachment (Zotero sandbox only). Zotero writes the plain text of
 * PDF, EPUB and HTML attachments to storage/<KEY>/.zotero-ft-cache when it indexes them, and full-text content synced
 * from another device to storage/<KEY>/.zotero-ft-unprocessed (JSON with `text`) until it processes it
 * (xpcom/fulltext.js). Only those two files are read: never the attachment itself, never item.attachmentText (which
 * runs the PDF worker when the cache is incomplete), never indexing, so nothing is written.
 */
import type { FulltextIndexState } from "../../../../shared/types/tools.js";
import { storageDirectory } from "./attachments.js";
import type { ZItem } from "./library.js";
import { safe } from "./refs.js";

/** Zotero.FullText.INDEX_STATE_* (xpcom/fulltext.js). */
const INDEX_STATES: Readonly<Record<number, FulltextIndexState>> = {
  0: "unavailable",
  1: "unindexed",
  2: "partial",
  3: "indexed",
  4: "queued",
};

export interface ExtractedText {
  indexState: FulltextIndexState;
  source: "cache" | "synced-content" | null;
  text: string | null;
  indexedPages: number | null;
  totalPages: number | null;
}

async function readIfPresent(path: string | null): Promise<string | null> {
  if (path === null) return null;
  try {
    return await IOUtils.readUTF8(path);
  } catch {
    // Missing (the common case) or unreadable: either way there is no text from this file.
    return null;
  }
}

function count(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

async function indexState(attachment: ZItem): Promise<FulltextIndexState> {
  try {
    return INDEX_STATES[Number(await Zotero.FullText.getIndexedState(attachment))] ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

/** PDF page counts from fulltextItems; null for other types (Zotero tracks characters for them). */
async function pageCounts(attachment: ZItem): Promise<{ indexedPages: number | null; totalPages: number | null }> {
  if (safe(() => attachment.attachmentContentType, "") !== "application/pdf") return { indexedPages: null, totalPages: null };
  try {
    const row = (await Zotero.FullText.getPages(attachment.id)) as { indexedPages?: unknown; total?: unknown } | false;
    return row ? { indexedPages: count(row.indexedPages), totalPages: count(row.total) } : { indexedPages: null, totalPages: null };
  } catch {
    return { indexedPages: null, totalPages: null };
  }
}

/** Extracted text of a file attachment and Zotero's index state for it. */
export async function extractedText(attachment: ZItem): Promise<ExtractedText> {
  const [state, pages] = await Promise.all([indexState(attachment), pageCounts(attachment)]);
  const dir = storageDirectory(attachment.key);
  const join = (name: string) => (dir === null ? null : safe(() => PathUtils.join(dir, name), null as string | null));

  const cached = await readIfPresent(join(".zotero-ft-cache"));
  if (cached !== null) return { indexState: state, source: "cache", text: cached.trim(), ...pages };

  const synced = await readIfPresent(join(".zotero-ft-unprocessed"));
  if (synced !== null) {
    try {
      const data = JSON.parse(synced) as { text?: unknown; indexedPages?: unknown; totalPages?: unknown };
      if (typeof data.text === "string") {
        return {
          indexState: state,
          source: "synced-content",
          text: data.text.trim(),
          indexedPages: pages.indexedPages ?? count(data.indexedPages),
          totalPages: pages.totalPages ?? count(data.totalPages),
        };
      }
    } catch {
      // Malformed file: treat as absent.
    }
  }
  return { indexState: state, source: null, text: null, ...pages };
}
