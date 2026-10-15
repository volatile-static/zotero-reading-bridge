/**
 * User content (Zotero sandbox only): list_tags, get_notes, get_annotations.
 * Notes and annotations are the user's source material; they are returned as data, never interpreted.
 */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import type { TagInfo } from "../../../../shared/types/tools.js";
import { annotationDetail, attachmentAnnotations, regularItemAnnotations } from "../zotero/annotations.js";
import { getItemByKey, type ZItem } from "../zotero/library.js";
import { inTrash, itemKind, itemsByID, loadLibrary, wrongItemType } from "../zotero/lookup.js";
import { noteDetail } from "../zotero/notes.js";
import { safe } from "../zotero/refs.js";
import { tagCountCache } from "../zotero/result-caches.js";
import { boolArg, enumSet, intArg, requireKey, textArg } from "./data-args.js";
import { containsFolded, tagInfos } from "./data-format.js";
import { paginate, paginateMapped, parsePageArgs } from "./pagination.js";
import { compareCodeUnits } from "./search-plan.js";
import { json, type ToolArgs, type ToolHandler, type ToolOutput } from "./types.js";

const ANNOTATION_TYPES = ["highlight", "underline", "note", "text", "image", "ink"] as const;

/** get_notes maxLength bounds and default (contract). */
const NOTE_MAX_LENGTH = { min: 100, max: 200_000, fallback: 20_000 } as const;

interface TagEntry extends TagInfo {
  /** Assigned tag color (#rrggbb), or null. */
  color: string | null;
  /** Number of non-trashed items (any level) carrying the tag with this type. */
  itemCount: number;
}

/**
 * Every tag of the library with its non-trashed item count, in tag-selector order. Counting from loaded items
 * (not Zotero.Tags.getAll, which also reports tags found only on trashed items) keeps trashed content out without
 * temporary tables; it visits every item, so the result is cached per library (src/zotero/result-caches.ts) and
 * later pages or filtered calls only slice it.
 */
async function libraryTagCounts(libraryID: number): Promise<ReadonlyArray<TagInfo & { itemCount: number }>> {
  return tagCountCache.getOrCompute(String(libraryID), async () => {
    const allItems = await Zotero.Items.getAll(libraryID, false, false);
    const counts = new Map<string, TagInfo & { itemCount: number }>();
    for (const item of allItems) {
      if (inTrash(item)) continue;
      for (const info of tagInfos(safe(() => item.getTags(), []))) {
        const id = `${info.type}\u0000${info.tag}`;
        const entry = counts.get(id);
        if (entry) entry.itemCount += 1;
        else counts.set(id, { ...info, itemCount: 1 });
      }
    }
    return [...counts.values()].sort(
      (a, b) => Zotero.localeCompare(a.tag, b.tag) || compareCodeUnits(a.tag, b.tag) || a.type - b.type,
    );
  });
}

async function listTags(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const query = textArg(args, "query");
  const lib = await loadLibrary(args.libraryID);
  const all = await libraryTagCounts(lib.libraryID);
  const matching = query === null ? all : all.filter((entry) => containsFolded(entry.tag, query));
  const colors = safe(() => Zotero.Tags.getColors(lib.libraryID), new Map<string, { color: string }>());
  // Colors are read live (they are settings, not item data) and only for the page.
  const pageResult = paginate([...matching], page);
  const items: TagEntry[] = pageResult.items.map(({ tag, type, itemCount }) => ({
    tag,
    type,
    color: colors.get(tag)?.color ?? null,
    itemCount,
  }));
  return json({ ...pageResult, items });
}

async function getNotes(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const options = {
    includeHtml: boolArg(args, "includeHtml", true),
    maxLength: intArg(args, "maxLength", NOTE_MAX_LENGTH.fallback, NOTE_MAX_LENGTH.min, NOTE_MAX_LENGTH.max),
  };
  const lib = await loadLibrary(args.libraryID);
  const item = await getItemByKey(lib, requireKey(args));
  let notes: ZItem[];
  switch (itemKind(item)) {
    case "note":
      notes = [item];
      break;
    case "regular":
      // Zotero's item-pane order (title or chronological per the sortNotesChronologically pref); no trashed notes.
      notes = itemsByID(safe(() => item.getNotes(false), [] as number[]));
      break;
    case "attachment":
      // The attachment's own note (shown in Zotero's attachment pane); an empty page when it has none.
      notes = safe(() => item.getNote(), "") ? [item] : [];
      break;
    default:
      throw wrongItemType(item, "a note, a regular item or an attachment");
  }
  return json(await paginateMapped(notes, page, (note) => noteDetail(note, options)));
}

async function getAnnotations(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const types = enumSet(args, "types", ANNOTATION_TYPES);
  const includePosition = boolArg(args, "includePosition", true);
  const lib = await loadLibrary(args.libraryID);
  const item = await getItemByKey(lib, requireKey(args));
  let annotations: ZItem[];
  switch (itemKind(item)) {
    case "annotation":
      annotations = [item];
      break;
    case "attachment":
      annotations = attachmentAnnotations(item);
      break;
    case "regular":
      annotations = regularItemAnnotations(item);
      break;
    default:
      throw wrongItemType(item, "an attachment, a regular item or an annotation");
  }
  if (types) {
    const wanted: ReadonlySet<string> = types;
    annotations = annotations.filter((ann) => wanted.has(safe(() => String(ann.annotationType), "")));
  }
  return json(await paginateMapped(annotations, page, (ann) => annotationDetail(ann, includePosition)));
}

export const contentHandlers = {
  list_tags: listTags,
  get_notes: getNotes,
  get_annotations: getAnnotations,
} satisfies Partial<Record<ToolName, ToolHandler>>;
