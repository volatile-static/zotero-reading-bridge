/**
 * Deterministic ZIP writing (archiver) and strict reading (yauzl) for the build and the verifier.
 * Determinism: entries sorted by name, fixed UTC mtime, fixed Unix mode 0644, no directory entries,
 * zlib level 9. Non-ASCII names get the UTF-8 flag from compress-commons automatically.
 */
import { ZipArchive } from "archiver";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import yauzl from "yauzl";
import { compareStrings, removeTree } from "./files.js";
import { PARTIAL_SUFFIX, ZIP_ENTRY_DATE } from "./layout.js";

export interface ZipInputEntry {
  /** Forward-slash path inside the archive. */
  name: string;
  data: Buffer;
}

export interface ZipReadEntry {
  name: string;
  data: Buffer;
  isDirectory: boolean;
  crcOk: boolean;
  /** General-purpose bit 11: the name is stored as UTF-8. */
  utf8Name: boolean;
  modified: Date;
}

const FILE_MODE = 0o644;
const UTF8_NAME_FLAG = 0x800;

/** Reason the entry name is unsafe or non-portable, or null when it is fine. */
export function validateEntryName(name: string): string | null {
  if (!name) return "empty entry name";
  if (name.includes("\\")) return `backslash in entry name: ${name}`;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return `absolute entry name: ${name}`;
  if (name.endsWith("/")) return `directory entry name: ${name}`;
  for (const segment of name.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return `invalid path segment in entry name: ${name}`;
  }
  // Control characters are rejected by Windows extractors and garble terminal reports.
  for (const ch of name) {
    if (ch.charCodeAt(0) < 0x20) return `control character in entry name: ${JSON.stringify(name)}`;
  }
  return null;
}

/** Sorted copy of `entries`; throws on invalid or duplicate names (case-insensitive, for Windows extraction). */
export function prepareEntries(entries: readonly ZipInputEntry[]): ZipInputEntry[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const problem = validateEntryName(entry.name);
    if (problem) throw new Error(problem);
    const folded = entry.name.toLowerCase();
    const previous = seen.get(folded);
    if (previous !== undefined) throw new Error(`duplicate entry name: ${entry.name} (also ${previous})`);
    seen.set(folded, entry.name);
  }
  return [...entries].sort((a, b) => compareStrings(a.name, b.name));
}

/**
 * Write `entries` to `outFile` via `<outFile>.partial` and rename on success, so a crash or error never
 * leaves a complete-looking archive behind.
 */
export async function writeZipAtomic(
  outFile: string,
  entries: readonly ZipInputEntry[],
  date: Date = ZIP_ENTRY_DATE,
): Promise<void> {
  const sorted = prepareEntries(entries);
  const partial = `${outFile}${PARTIAL_SUFFIX}`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const output = fs.createWriteStream(partial);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  try {
    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      // archiver reports recoverable problems (e.g. stat failures) as warnings; any of them means a bad archive.
      archive.on("warning", reject);
      archive.pipe(output);
      for (const entry of sorted) {
        archive.append(entry.data, { name: entry.name, date, mode: FILE_MODE });
      }
      archive.finalize().catch(reject);
    });
    fs.renameSync(partial, outFile);
  } catch (error) {
    archive.abort();
    output.destroy();
    await new Promise<void>((resolve) => (output.closed ? resolve() : output.once("close", () => resolve())));
    removeTree(partial);
    throw error;
  }
}

/** Structural problems of an archive read with readZip, judged against what writeZipAtomic produces. */
export function zipEntryProblems(entries: readonly ZipReadEntry[], date: Date = ZIP_ENTRY_DATE): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const entry of entries) {
    if (entry.isDirectory) {
      problems.push(`unexpected directory entry ${entry.name}`);
      continue;
    }
    const nameProblem = validateEntryName(entry.name);
    if (nameProblem) problems.push(nameProblem);
    const folded = entry.name.toLowerCase();
    if (seen.has(folded)) problems.push(`duplicate entry ${entry.name}`);
    seen.add(folded);
    if (previous !== null && compareStrings(previous, entry.name) > 0) problems.push(`entry ${entry.name} is out of order`);
    previous = entry.name;
    if (!entry.crcOk) problems.push(`CRC-32 mismatch in ${entry.name}`);
    if (!entry.utf8Name && /[^\x20-\x7e]/.test(entry.name)) problems.push(`non-ASCII name without UTF-8 flag: ${entry.name}`);
    if (entry.modified.getTime() !== date.getTime()) problems.push(`non-fixed mtime on ${entry.name}`);
  }
  if (entries.length === 0) problems.push("archive is empty");
  return problems;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

/**
 * Read every entry of a ZIP strictly: yauzl rejects absolute/`..`/backslash names (strictFileNames) and
 * size mismatches; CRC-32 is recomputed here because yauzl does not check it.
 */
export async function readZip(file: string): Promise<ZipReadEntry[]> {
  const zip = await yauzl.openPromise(file, { strictFileNames: true, validateEntrySizes: true, decodeStrings: true });
  const entries: ZipReadEntry[] = [];
  try {
    for await (const entry of zip.eachEntry()) {
      const isDirectory = entry.fileName.endsWith("/");
      const data = isDirectory ? Buffer.alloc(0) : await readAll(await zip.openReadStreamPromise(entry));
      entries.push({
        name: entry.fileName,
        data,
        isDirectory,
        crcOk: isDirectory || zlib.crc32(data) >>> 0 === entry.crc32 >>> 0,
        utf8Name: (entry.generalPurposeBitFlag & UTF8_NAME_FLAG) !== 0,
        modified: entry.getLastModDate({ timezone: "UTC" }),
      });
    }
  } finally {
    zip.close();
  }
  return entries;
}
