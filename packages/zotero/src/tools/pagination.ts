/**
 * Pure pagination helpers shared by every list tool. Cursors are opaque to clients ("o<offset>").
 */
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from "../../../../shared/types/bridge.js";
import type { Page } from "../../../../shared/types/tools.js";
import { ToolError } from "./types.js";

const CURSOR_RE = /^o(0|[1-9][0-9]{0,8})$/;

export interface PageRequest {
  offset: number;
  limit: number;
}

/** Parse `limit` / `cursor` tool arguments (already schema-validated for type and range). */
export function parsePageArgs(args: { limit?: unknown; cursor?: unknown }): PageRequest {
  let limit = PAGE_LIMIT_DEFAULT;
  if (typeof args.limit === "number" && Number.isInteger(args.limit)) {
    limit = Math.min(Math.max(args.limit, 1), PAGE_LIMIT_MAX);
  }
  let offset = 0;
  if (args.cursor !== undefined) {
    const match = typeof args.cursor === "string" ? CURSOR_RE.exec(args.cursor) : null;
    if (!match || match[1] === undefined) {
      throw new ToolError("INVALID_ARGUMENT", "Invalid cursor; pass back nextCursor exactly as returned", {
        cursor: String(args.cursor).slice(0, 64),
      });
    }
    offset = Number(match[1]);
  }
  return { offset, limit };
}

export function encodeCursor(offset: number): string {
  return `o${offset}`;
}

/** Slice an already-materialized list into a page. */
export function paginate<T>(all: readonly T[], req: PageRequest): Page<T> {
  const items = all.slice(req.offset, req.offset + req.limit);
  const next = req.offset + items.length;
  return {
    items,
    total: all.length,
    offset: req.offset,
    limit: req.limit,
    nextCursor: next < all.length ? encodeCursor(next) : null,
  };
}

/**
 * Page over a list of cheap keys/ids, materializing only the requested slice.
 * `map` may drop entries (returning null), in which case the page is shorter but totals stay exact.
 */
export async function paginateMapped<K, T>(
  all: readonly K[],
  req: PageRequest,
  map: (key: K) => Promise<T | null> | T | null,
): Promise<Page<T>> {
  const slice = all.slice(req.offset, req.offset + req.limit);
  const items: T[] = [];
  for (const key of slice) {
    const value = await map(key);
    if (value !== null) items.push(value);
  }
  const next = req.offset + slice.length;
  return {
    items,
    total: all.length,
    offset: req.offset,
    limit: req.limit,
    nextCursor: next < all.length ? encodeCursor(next) : null,
  };
}
