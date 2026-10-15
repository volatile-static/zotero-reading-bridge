/**
 * Note serialization (Zotero sandbox only).
 */
import type { NoteDetail } from "../../../../shared/types/tools.js";
import { tagInfos } from "../tools/data-format.js";
import { htmlToPlainTextFallback, normalizeWhitespace, truncateText } from "../util/text.js";
import type { ZItem } from "./library.js";
import { itemRef, itemSelectURI, safe, sqlToISO } from "./refs.js";

/**
 * Note HTML -> plain text with Gecko's serializer, as Zotero does for its note index (xpcom/fulltext.js) and
 * annotation titles (xpcom/data/item.js): block boundaries become line breaks and entities are decoded.
 * The plugin sandbox has Components but not the Cc/Ci shorthands.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  try {
    // Components.classes is typed without the contract-ID index signature that the Cc typing has.
    const factory = (Components.classes as unknown as nsXPCComponents_Classes)["@mozilla.org/parserutils;1"];
    if (!factory) return htmlToPlainTextFallback(html);
    const parser = factory.getService(Components.interfaces.nsIParserUtils);
    // The typings declare XPCOM constants optional; OutputRaw is 4.
    const outputRaw = Components.interfaces.nsIDocumentEncoder.OutputRaw ?? 4;
    return normalizeWhitespace(parser.convertToPlainText(html, outputRaw, 0));
  } catch {
    return htmlToPlainTextFallback(html);
  }
}

export interface NoteOptions {
  includeHtml: boolean;
  /** Cap for both html and text, in UTF-16 code units. */
  maxLength: number;
}

export function noteDetail(note: ZItem, options: NoteOptions): NoteDetail {
  const html = safe(() => note.getNote(), "");
  const text = htmlToPlainText(html);
  const textCut = truncateText(text, options.maxLength);
  const htmlCut = options.includeHtml ? truncateText(html, options.maxLength) : null;
  return {
    ...itemRef(note),
    parentKey: safe(() => (note.parentKey as string | false) || null, null),
    noteTitle: safe(() => note.getNoteTitle(), ""),
    html: htmlCut ? htmlCut.text : null,
    text: textCut.text,
    length: text.length,
    truncated: textCut.truncated || (htmlCut?.truncated ?? false),
    tags: tagInfos(safe(() => note.getTags(), [])),
    dateModified: sqlToISO(safe(() => note.dateModified, "")),
    uri: itemSelectURI(note.libraryID, note.key),
  };
}
