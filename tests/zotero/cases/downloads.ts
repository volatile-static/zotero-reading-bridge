/** Opt-in network smoke test; all downloads run in the disposable Zotero profile. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { diffFingerprints, stableFingerprint } from "../lib/readonly.js";
import { isInside } from "../lib/paths.js";
import { SkipCase, type TestCase } from "./types.js";
import type { FulltextDownload } from "../../../shared/types/tools.js";
import { ZOTERO_ADDON_ID } from "../../../shared/types/bridge.js";

export const downloadCases: TestCase[] = [{
  id: "downloads.publisher-captcha",
  title: "Manually verify publisher CAPTCHA and download an article without adding library items",
  requires: ["bridge", "fixtures"],
  timeoutMs: 240000,
  async run(ctx) {
    const url = process.env.ZAB_TEST_ARTICLE_URL;
    if (!url) throw new SkipCase("Set ZAB_TEST_ARTICLE_URL for the interactive publisher test.");
    const before = await stableFingerprint(ctx.seed, []);
    let job = await ctx.mcp().tool("download_fulltext", { url, kind: "page", allowCaptcha: true }) as FulltextDownload;
    console.log(`Publisher download ${job.downloadID}: complete any CAPTCHA in the Zotero test window.`);
    const deadline = Date.now() + 210000;
    while (job.status === "running" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      job = await ctx.mcp().tool("get_fulltext_download", { downloadID: job.downloadID });
    }
    assert.equal(job.status, "complete", JSON.stringify(job));
    assert.ok(job.path && isInside(ctx.layout.profileDir, job.path));
    assert.equal(fs.readFileSync(job.path!).subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(diffFingerprints(before, await stableFingerprint(ctx.seed, [])), []);
    return job;
  },
}, {
  id: "downloads.temporary-pdf",
  title: "Download a PDF via direct and page resolvers without changing the library",
  requires: ["bridge", "fixtures"],
  timeoutMs: 180000,
  async run(ctx) {
    const url = process.env.ZAB_TEST_PDF_URL;
    if (!url) throw new SkipCase("Set ZAB_TEST_PDF_URL to a public test PDF to run the network smoke test.");
    const before = await stableFingerprint(ctx.seed, []);
    const results: FulltextDownload[] = [];
    for (const kind of ["pdf", "page"]) {
      let job = await ctx.mcp().tool("download_fulltext", { url, kind, allowCaptcha: false }) as FulltextDownload;
      assert.equal(job.status, "running");
      const deadline = Date.now() + 75000;
      while (job.status === "running" && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, job.pollAfterMs ?? 2000));
        job = await ctx.mcp().tool("get_fulltext_download", { downloadID: job.downloadID });
      }
      assert.equal(job.status, "complete", JSON.stringify(job));
      assert.ok(job.path && isInside(ctx.layout.profileDir, job.path), "PDF stays inside the test profile temp directory");
      const bytes = fs.readFileSync(job.path!);
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert.equal(job.bytes, bytes.length);
      results.push(job);
    }
    const after = await stableFingerprint(ctx.seed, []);
    assert.deepEqual(diffFingerprints(before, after), [], "download must not add or change library data");
    try {
      await ctx.seed.addon({ id: ZOTERO_ADDON_ID, action: "disable" });
      const cleanupDeadline = Date.now() + 5000;
      while (results.some(result => fs.existsSync(result.path!)) && Date.now() < cleanupDeadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(results.every(result => !fs.existsSync(result.path!)), "disabling the plugin removes temporary PDFs");
    } finally {
      await ctx.seed.addon({ id: ZOTERO_ADDON_ID, action: "enable" });
    }
    return results;
  },
}];
