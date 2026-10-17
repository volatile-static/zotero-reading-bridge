/**
 * Cached renderings of image annotations (Zotero sandbox only). Zotero writes <data dir>/cache/library/<KEY>.png
 * when the reader renders an image annotation (xpcom/annotations.js getCacheImagePath); this module only reads that
 * file and never asks Zotero to render one, so a missing PNG stays missing.
 */
import type { AnnotationImage } from "../../../../shared/types/tools.js";
import type { ImageContent } from "../../../../shared/types/mcp.js";
import type { ImageBudget } from "../tools/image-budget.js";
import { base64Encode } from "../util/base64.js";
import { safe } from "./refs.js";

const MISSING_NOTE =
  "Zotero has not rendered this image annotation on this computer yet (it may have been synced from another device). Opening the PDF in Zotero at this page creates the image.";

export interface LoadedImage {
  image: AnnotationImage;
  /** Present when the PNG is attached (image.included). */
  content: ImageContent | null;
}

/** Status of an image annotation's cached PNG and, when `budget` is given and admits it, its bytes. */
export async function loadAnnotationImage(
  ref: { libraryID: number; key: string },
  budget: ImageBudget | null,
): Promise<LoadedImage> {
  const cachePath = safe(() => Zotero.Annotations.getCacheImagePath(ref), null as string | null) || null;
  const base: AnnotationImage = { cachePath, exists: false, bytes: null, included: false, note: null };
  if (cachePath === null) {
    return { image: { ...base, note: "Zotero could not compute the cache path of this image annotation." }, content: null };
  }
  let bytes: number;
  try {
    const info = await IOUtils.stat(cachePath);
    if (info.type !== "regular") return { image: { ...base, note: MISSING_NOTE }, content: null };
    bytes = Number(info.size);
  } catch {
    return { image: { ...base, note: MISSING_NOTE }, content: null };
  }
  const found: AnnotationImage = { ...base, exists: true, bytes };
  if (budget === null) return { image: found, content: null };
  const refused = budget.admit(bytes);
  if (refused !== null) return { image: { ...found, note: refused }, content: null };
  try {
    const data = base64Encode(await IOUtils.read(cachePath));
    return { image: { ...found, included: true }, content: { type: "image", data, mimeType: "image/png" } };
  } catch {
    return { image: { ...found, note: "The cached image could not be read." }, content: null };
  }
}
