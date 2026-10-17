/**
 * Standard base64 (RFC 4648, padded). Pure: the bootstrap sandbox has no btoa, and Uint8Array.prototype.toBase64
 * is too new to rely on across Zotero builds.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  const full = bytes.length - (bytes.length % 3);
  for (let i = 0; i < full; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    chunk += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
    // Flush periodically so a megabyte image does not grow one string a character at a time.
    if (chunk.length >= 65_536) {
      parts.push(chunk);
      chunk = "";
    }
  }
  const rest = bytes.length - full;
  if (rest === 1) {
    const n = bytes[full]! << 16;
    chunk += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + "==";
  } else if (rest === 2) {
    const n = (bytes[full]! << 16) | (bytes[full + 1]! << 8);
    chunk += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + "=";
  }
  parts.push(chunk);
  return parts.join("");
}
