/**
 * Byte budget for the annotation images attached to one tool result. Pure: no Zotero globals (unit-tested in Node).
 */
import { ANNOTATION_IMAGE_LIMITS } from "../../../../shared/types/tools.js";

export class ImageBudget {
  private used = 0;

  constructor(private readonly limits: { perImageBytes: number; perCallBytes: number } = ANNOTATION_IMAGE_LIMITS) {}

  /** Reserve `bytes` for one image; returns null when admitted, else the reason it is not attached. */
  admit(bytes: number): string | null {
    if (bytes > this.limits.perImageBytes) {
      return `The cached image is ${bytes} bytes, over the ${this.limits.perImageBytes}-byte limit for one image; open it from cachePath instead.`;
    }
    if (this.used + bytes > this.limits.perCallBytes) {
      return `This result already carries ${this.used} bytes of images (limit ${this.limits.perCallBytes}); request this annotation on its own to see it.`;
    }
    this.used += bytes;
    return null;
  }
}
