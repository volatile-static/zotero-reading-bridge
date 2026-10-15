/**
 * Builds the TEST-ONLY seed plugin XPI (manifest.json + bundled bootstrap.js) into a harness run
 * directory. Never written to outputs/: the seed plugin is not a deliverable.
 *
 * Usage: tsx tests/zotero/build-seed.ts <out.xpi>   (the path must be inside work/zotero-test)
 */
import { ZipArchive } from "archiver";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_ADDON_ID } from "./seed-api.js";
import { SEED_PLUGIN_DIR, assertTestPath } from "./lib/paths.js";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

async function bundleBootstrap(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(SEED_PLUGIN_DIR, "src", "bootstrap.ts")],
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: "firefox140",
    write: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("esbuild produced no output for the seed bootstrap");
  return output.text;
}

function readManifest(): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(SEED_PLUGIN_DIR, "manifest.json"), "utf8")) as {
    applications?: { zotero?: { id?: string } };
  };
  if (manifest.applications?.zotero?.id !== SEED_ADDON_ID) {
    throw new Error(`Seed manifest id must be ${SEED_ADDON_ID}`);
  }
  return JSON.stringify(manifest, null, 2);
}

export async function buildSeedXpi(outFile: string): Promise<string> {
  const target = assertTestPath(outFile, "seed XPI");
  const bootstrap = await bundleBootstrap();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = fs.createWriteStream(target);
  const closed = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.append(readManifest(), { name: "manifest.json", date: FIXED_DATE });
  archive.append(bootstrap, { name: "bootstrap.js", date: FIXED_DATE });
  await archive.finalize();
  await closed;
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: tsx tests/zotero/build-seed.ts <out.xpi inside work/zotero-test>");
    process.exit(2);
  }
  buildSeedXpi(out).then(
    (file) => console.log(`Seed plugin written to ${file}`),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
