/**
 * Small helpers shared by the seed plugin modules (Zotero sandbox only).
 */

/** Zotero endpoint return value: [status, headers, body]. */
export type EndpointResponse = [number, Record<string, string>, string];

/** Escape every non-ASCII code unit so the body's byte length equals its string length. */
export function escapeNonAscii(json: string): string {
  return json.replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function jsonResponse(status: number, payload: unknown): EndpointResponse {
  const body = escapeNonAscii(JSON.stringify(payload));
  return [status, { "Content-Type": "application/json", "Content-Length": String(body.length) }, body];
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `probe` until it returns a non-null value or the timeout expires. */
export async function waitFor<T>(
  what: string,
  probe: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs = 15000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null && value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}${lastError ? ` (${errorMessage(lastError)})` : ""}`);
}

/** Copy a (possibly content-compartment) value into plain chrome JSON; null when not serializable. */
export function cloneJson<T>(value: unknown): T | null {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as T;
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Case-insensitive, separator-insensitive path comparison key (the harness runs on Windows). */
export function pathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
