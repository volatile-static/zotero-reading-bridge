/**
 * Items (Zotero sandbox only): search_items, get_items, get_item_children.
 */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import type { AnnotationRef, AttachmentSummary, ItemDetail, ItemRef } from "../../../../shared/types/tools.js";
import { ANNOTATION_TEXT_MAX, attachmentAnnotations } from "../zotero/annotations.js";
import { attachmentSummary } from "../zotero/attachments.js";
import { getItemByKey, type ZItem } from "../zotero/library.js";
import { inTrash, itemKind, itemsByID, loadLibrary, wrongItemType } from "../zotero/lookup.js";
import {
  annotationLink,
  annotationRef,
  itemRef,
  itemSelectURI,
  itemSummary,
  safe,
  sqlToISO,
} from "../zotero/refs.js";
import { searchLibraryItems } from "../zotero/search.js";
import { boolArg, enumSet, keyList, normalizeSearchArgs, requireKey } from "./data-args.js";
import { creatorInfos, itemFieldsFromJSON, relationsFromJSON, tagInfos } from "./data-format.js";
import { paginateMapped, parsePageArgs } from "./pagination.js";
import { json, type ToolArgs, type ToolHandler, type ToolOutput } from "./types.js";

/** get_items accepts at most this many keys (contract maxItems). */
const MAX_DETAIL_KEYS = 50;
/**
 * get_items lists at most this many child notes and attachments per item (counts stay exact), so the response size
 * depends on the number of keys rather than on how many children an item has; get_item_children pages through all.
 */
const CHILDREN_LISTED = 10;

const CHILD_TYPES = ["note", "attachment", "annotation"] as const;

type ChildEntry =
  | ({ childType: "note"; parentKey: string | null; dateModified: string; uri: string } & ItemRef)
  | ({ childType: "attachment"; uri: string } & AttachmentSummary)
  | ({ childType: "annotation"; itemID: number; attachmentKey: string; link: string } & AnnotationRef);

async function searchItems(args: ToolArgs): Promise<ToolOutput> {
  const request = normalizeSearchArgs(args);
  const page = parsePageArgs(args);
  const lib = await loadLibrary(args.libraryID);
  const items = await searchLibraryItems(lib, request);
  return json(await paginateMapped(items, page, (item) => itemSummary(item, { childCounts: true })));
}

/** Keys of the non-trashed collections a top-level item is filed in. */
function collectionKeys(item: ZItem): string[] {
  const ids = safe(() => item.getCollections(), [] as number[]);
  const keys: string[] = [];
  for (const id of ids) {
    const ref = safe(() => Zotero.Collections.getLibraryAndKeyFromID(id), false as const);
    if (ref) keys.push(ref.key);
  }
  return keys;
}

/** Child summary of a regular item: exact counts plus the first CHILDREN_LISTED notes and attachments. */
function childSummary(item: ZItem): NonNullable<ItemDetail["children"]> {
  const notes = itemsByID(safe(() => item.getNotes(false), [] as number[]));
  const attachments = itemsByID(safe(() => item.getAttachments(false), [] as number[]));
  return {
    noteCount: notes.length,
    attachmentCount: attachments.length,
    notes: notes.slice(0, CHILDREN_LISTED).map(itemRef),
    attachments: attachments.slice(0, CHILDREN_LISTED).map(attachmentSummary),
    truncated: notes.length > CHILDREN_LISTED || attachments.length > CHILDREN_LISTED,
  };
}

function itemDetail(item: ZItem, includeChildren: boolean): ItemDetail {
  const data = safe(() => item.toJSON() as unknown as Record<string, unknown>, {} as Record<string, unknown>);
  const regular = itemKind(item) === "regular";
  return {
    ...itemSummary(item),
    fields: itemFieldsFromJSON(data),
    creators: creatorInfos(data.creators),
    tags: tagInfos(safe(() => item.getTags(), [])),
    collections: collectionKeys(item),
    relations: relationsFromJSON(data.relations),
    deleted: inTrash(item),
    children: includeChildren && regular ? childSummary(item) : null,
  };
}

async function getItems(args: ToolArgs): Promise<ToolOutput> {
  const keys = keyList(args, "keys", MAX_DETAIL_KEYS);
  const includeChildren = boolArg(args, "includeChildren", true);
  const lib = await loadLibrary(args.libraryID);
  const items: ItemDetail[] = [];
  const notFound: string[] = [];
  for (const key of keys) {
    // Explicit keys return trashed items too, flagged with deleted: true.
    const item = Zotero.Items.getByLibraryAndKey(lib.libraryID, key) as ZItem | false;
    if (item) items.push(itemDetail(item, includeChildren));
    else notFound.push(key);
  }
  return json({ items, notFound });
}

function childEntry(child: ZItem): ChildEntry {
  switch (itemKind(child)) {
    case "note":
      return {
        childType: "note",
        ...itemRef(child),
        parentKey: safe(() => (child.parentKey as string | false) || null, null),
        dateModified: sqlToISO(safe(() => child.dateModified, "")),
        uri: itemSelectURI(child.libraryID, child.key),
      };
    case "annotation":
      return {
        childType: "annotation",
        ...annotationRef(child, ANNOTATION_TEXT_MAX),
        itemID: child.id,
        attachmentKey: safe(() => (child.parentKey as string | false) || "", ""),
        link: annotationLink(child),
      };
    default:
      return { childType: "attachment", ...attachmentSummary(child), uri: itemSelectURI(child.libraryID, child.key) };
  }
}

async function getItemChildren(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const types = enumSet(args, "types", CHILD_TYPES) ?? new Set(CHILD_TYPES);
  const lib = await loadLibrary(args.libraryID);
  const item = await getItemByKey(lib, requireKey(args));
  let children: ZItem[] = [];
  switch (itemKind(item)) {
    case "regular":
      // Notes, then attachments, each in Zotero's item-pane order; trashed children are left out.
      if (types.has("note")) children = itemsByID(safe(() => item.getNotes(false), [] as number[]));
      if (types.has("attachment")) children = children.concat(itemsByID(safe(() => item.getAttachments(false), [] as number[])));
      break;
    case "attachment":
      if (types.has("annotation")) children = attachmentAnnotations(item);
      break;
    default:
      throw wrongItemType(item, "a regular item or an attachment (notes and annotations have no children)");
  }
  return json(await paginateMapped(children, page, childEntry));
}

export const itemHandlers = {
  search_items: searchItems,
  get_items: getItems,
  get_item_children: getItemChildren,
} satisfies Partial<Record<ToolName, ToolHandler>>;
