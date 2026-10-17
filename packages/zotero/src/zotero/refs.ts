/**
 * Serializers from Zotero objects to the shared result shapes, plus zotero:// URI builders.
 * Every accessor is defensive: an unloaded data type or a removed property must not fail a whole listing.
 */
import type {
  AnnotationRef,
  CollectionRef,
  ItemRef,
  ItemSummary,
  LibraryRef,
  LibraryType,
  SavedSearchRef,
} from "../../../../shared/types/tools.js";
import { stripBidiIsolates, truncateText } from "../util/text.js";
import type { ZCollection, ZItem, ZLibrary, ZSearch } from "./library.js";

/** Run an accessor, returning `fallback` if it throws (e.g. UnloadedDataException). */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/** "library" for the personal library, "groups/<groupID>" for groups (zotero:// and Web API prefix). */
export function libraryPrefix(libraryID: number): string {
  const viaApi = safe(() => (Zotero as any).API.getLibraryPrefix(libraryID) as string, "");
  if (viaApi) return viaApi;
  const lib = safe(() => Zotero.Libraries.get(libraryID) as ZLibrary | false, false as const);
  if (lib && lib.libraryType === "group") {
    return `groups/${(lib as any).groupID}`;
  }
  return "library";
}

export function itemSelectURI(libraryID: number, key: string): string {
  // Zotero's select URI router cannot address feed libraries. Do not manufacture a personal-library link.
  if (safe(() => {
    const library = Zotero.Libraries.get(libraryID);
    return !!library && library.libraryType === "feed";
  }, false)) return "";
  return `zotero://select/${libraryPrefix(libraryID)}/items/${key}`;
}

export function collectionSelectURI(libraryID: number, key: string): string {
  return `zotero://select/${libraryPrefix(libraryID)}/collections/${key}`;
}

/** Zotero stores dates as SQL UTC "YYYY-MM-DD HH:MM:SS"; return ISO 8601 (or the input when unparsable). */
export function sqlToISO(value: string | null | undefined): string {
  if (!value) return "";
  return safe(() => Zotero.Date.sqlToISO8601(value) as string, value);
}

export function libraryRef(lib: ZLibrary): LibraryRef {
  const type = lib.libraryType as LibraryType;
  const ref: LibraryRef = { libraryID: lib.libraryID, type, name: safe(() => lib.name, "") };
  if (type === "group") {
    const groupID = safe(() => (lib as any).groupID as number, 0);
    if (groupID) ref.groupID = groupID;
  }
  return ref;
}

export function itemRef(item: ZItem): ItemRef {
  return {
    libraryID: item.libraryID,
    key: item.key,
    itemID: item.id,
    itemType: safe(() => item.itemType as string, "unknown"),
    title: safe(() => item.getDisplayTitle(), ""),
  };
}

/**
 * A field by base name, read through Zotero's base-field mapping (getField(name, false, true)): publicationTitle
 * is bookTitle for a book section, proceedingsTitle for a conference paper, websiteTitle for a web page...;
 * date is dateDecided for a case, issueDate for a patent, dateEnacted for a statute. Without the mapping those
 * types report an empty value although the item has one (the date sort already reads mapped values).
 */
function baseField(item: ZItem, name: string): string {
  return safe(() => String((item as any).getField(name, false, true) ?? ""), "");
}

export function itemYear(item: ZItem): string | null {
  const date = baseField(item, "date");
  if (!date) return null;
  const parsed = safe(() => (Zotero.Date.strToDate(date) as { year?: string | number }).year, undefined);
  if (parsed !== undefined && parsed !== null && String(parsed) !== "") return String(parsed);
  const match = /\b(\d{4})\b/.exec(date);
  return match?.[1] ?? null;
}

/**
 * Zotero builds firstCreator in SQL and wraps each name of a two-creator item in U+2068 / U+2069 bidi isolates
 * (FIRST STRONG ISOLATE + name + POP DIRECTIONAL ISOLATE); getField('firstCreator', true) is Zotero's unformatted
 * form without them. They are stripped again in case a build returns them anyway: they are invisible and break
 * string matching (a name copied into a creator filter would match nothing).
 */
export function creatorSummary(item: ZItem): string {
  const value = safe(() => String((item as any).getField("firstCreator", true) ?? ""), "");
  return stripBidiIsolates(value || safe(() => String((item as any).firstCreator ?? ""), ""));
}

export function itemSummary(item: ZItem, options: { childCounts?: boolean } = {}): ItemSummary {
  const ref = itemRef(item);
  const isRegular = safe(() => item.isRegularItem(), false);
  const summary: ItemSummary = {
    ...ref,
    creatorSummary: isRegular ? creatorSummary(item) : "",
    year: isRegular ? itemYear(item) : null,
    date: isRegular ? baseField(item, "date") || null : null,
    publicationTitle: isRegular ? baseField(item, "publicationTitle") || null : null,
    DOI: isRegular ? baseField(item, "DOI") || null : null,
    parentKey: safe(() => (item.parentKey as string | false) || null, null),
    dateAdded: sqlToISO(safe(() => item.dateAdded, "")),
    dateModified: sqlToISO(safe(() => item.dateModified, "")),
    uri: itemSelectURI(item.libraryID, item.key),
  };
  if (options.childCounts && isRegular) {
    summary.childCounts = {
      notes: safe(() => item.getNotes(false).length, 0),
      attachments: safe(() => item.getAttachments(false).length, 0),
    };
  }
  return summary;
}

export function collectionRef(col: ZCollection): CollectionRef {
  return {
    libraryID: col.libraryID,
    key: col.key,
    collectionID: col.id,
    name: safe(() => col.name, ""),
    parentKey: safe(() => (col.parentKey as string | false) || null, null),
  };
}

export function savedSearchRef(search: ZSearch): SavedSearchRef {
  return {
    libraryID: search.libraryID,
    key: search.key,
    searchID: search.id,
    name: safe(() => search.name, ""),
  };
}

/** Parse annotationPosition (a JSON string); null when absent or malformed. */
export function annotationPosition(ann: ZItem): any {
  const raw = safe(() => (ann as any).annotationPosition as string | null, null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** zotero://open-pdf link that opens the reader at the annotation (page is 1-based physical page). */
export function annotationLink(ann: ZItem): string {
  const attachment = safe(() => ann.parentItem as ZItem | undefined, undefined);
  const attachmentKey = attachment?.key ?? safe(() => ann.parentKey as string, "");
  const position = annotationPosition(ann);
  const query: string[] = [];
  if (position?.type === "FragmentSelector" && typeof position.value === "string") {
    query.push(`cfi=${encodeURIComponent(position.value)}`);
  } else if (position?.type === "CssSelector" && typeof position.value === "string") {
    query.push(`sel=${encodeURIComponent(position.value)}`);
  } else if (Number.isInteger(position?.pageIndex)) {
    query.push(`page=${position.pageIndex + 1}`);
  }
  query.push(`annotation=${ann.key}`);
  return `zotero://open-pdf/${libraryPrefix(ann.libraryID)}/items/${attachmentKey}?${query.join("&")}`;
}

export function annotationRef(ann: ZItem, maxText: number): AnnotationRef {
  const textValue = safe(() => (ann as any).annotationText as string | null, null);
  const commentValue = safe(() => (ann as any).annotationComment as string | null, null);
  return {
    libraryID: ann.libraryID,
    key: ann.key,
    annotationType: safe(() => String((ann as any).annotationType), "unknown"),
    text: textValue ? truncateText(textValue, maxText).text : null,
    comment: commentValue ? truncateText(commentValue, maxText).text : null,
    color: safe(() => ((ann as any).annotationColor as string | null) || null, null),
    pageLabel: safe(() => ((ann as any).annotationPageLabel as string | null) || null, null),
  };
}
