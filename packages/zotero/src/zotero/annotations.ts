/**
 * Annotation collection and serialization (Zotero sandbox only).
 */
import type { ImageContent } from "../../../../shared/types/mcp.js";
import type { AnnotationDetail } from "../../../../shared/types/tools.js";
import { ANNOTATION_TEXT_MAX, annotationPageIndex, tagInfos } from "../tools/data-format.js";
import type { ImageBudget } from "../tools/image-budget.js";
import { loadAnnotationImage } from "./annotation-images.js";
import type { ZItem } from "./library.js";
import { itemsByID } from "./lookup.js";
import { annotationLink, annotationPosition, annotationRef, safe, sqlToISO } from "./refs.js";

/** Generous cap for highlight text: long multi-paragraph highlights stay whole; a pathological one can't flood. */
export { ANNOTATION_TEXT_MAX };

/** AnnotationDetail whose position is omitted when the caller passes includePosition: false. */
export type AnnotationOutput = Omit<AnnotationDetail, "position"> & { position?: unknown };

/** Non-trashed annotations of a file attachment, in reader order (sortIndex); [] for linked URLs. */
export function attachmentAnnotations(attachment: ZItem): ZItem[] {
  // getAnnotations() throws on anything but file attachments.
  if (!safe(() => attachment.isFileAttachment(), false)) return [];
  return safe(() => [...attachment.getAnnotations(false)], [] as ZItem[]);
}

/** Annotations of every non-trashed attachment of a regular item, attachment by attachment. */
export function regularItemAnnotations(item: ZItem): ZItem[] {
  return itemsByID(safe(() => item.getAttachments(false), [] as number[])).flatMap(attachmentAnnotations);
}

/**
 * Serialize one annotation. For an image annotation, `images` (when given) receives its cached PNG as an image
 * content item if `budget` admits it; with `budget` null only the image status is reported.
 */
export async function annotationDetail(
  ann: ZItem,
  includePosition: boolean,
  images: { budget: ImageBudget | null; out: ImageContent[] },
): Promise<AnnotationOutput> {
  const attachment = safe(() => ann.parentItem, undefined);
  const position = annotationPosition(ann);
  const sortIndex = safe(() => ann.annotationSortIndex as string | null, null) || null;
  const detail: AnnotationOutput = {
    ...annotationRef(ann, ANNOTATION_TEXT_MAX),
    itemID: ann.id,
    attachmentKey: attachment?.key ?? safe(() => (ann.parentKey as string | false) || "", ""),
    parentItemKey: attachment ? safe(() => (attachment.parentKey as string | false) || null, null) : null,
    pageIndex: annotationPageIndex(position, sortIndex),
    sortIndex,
    tags: tagInfos(safe(() => ann.getTags(), [])),
    authorName: safe(() => ann.annotationAuthorName as string | null, null) || null,
    isExternal: safe(() => !!ann.annotationIsExternal, false),
    dateModified: sqlToISO(safe(() => ann.dateModified, "")),
    link: annotationLink(ann),
    image: null,
  };
  if (detail.annotationType === "image") {
    const loaded = await loadAnnotationImage({ libraryID: detail.libraryID, key: detail.key }, images.budget);
    detail.image = loaded.image;
    if (loaded.content) images.out.push(loaded.content);
  }
  // Ink paths and image rects are bounded by the page, so positions are returned as stored.
  if (includePosition) detail.position = position;
  return detail;
}
