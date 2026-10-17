import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { FulltextDownloads, DOWNLOAD_TTL_MS, downloadURL, type DownloadBackend } from "../../packages/zotero/src/tools/fulltext-download.js";

const services: FulltextDownloads[] = [];
afterEach(() => { for (const service of services.splice(0)) service.stop(); });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const url = "https://publisher.example/article/123";

function setup(download: DownloadBackend["download"] = async () => ({ url: `${url}.pdf`, bytes: 100 })) {
  let sequence = 0;
  const removed: string[] = [];
  const service = new FulltextDownloads({
    id: () => `job-${++sequence}`,
    allocate: async id => `/temp/${id}.pdf`,
    download,
    remove: async path => { removed.push(path); },
    log: () => {},
  });
  services.push(service);
  return { service, removed };
}

describe("temporary full-text downloads", () => {
  it("returns immediately, permits CAPTCHA UI, and deduplicates an active request", async () => {
    let finish!: (result: { url: string; bytes: number }) => void;
    let calls = 0;
    const { service } = setup(async request => {
      calls++;
      assert.deepEqual(request, { url, kind: "page", allowCaptcha: true });
      return new Promise(resolve => { finish = resolve; });
    });
    const job = service.start({ url });
    assert.equal(job.status, "running");
    assert.equal(job.path, null);
    assert.match(job.note, /CAPTCHA/);
    assert.equal(service.start({ url }).downloadID, job.downloadID);
    assert.throws(() => service.start({ url: `${url}/other` }), /Another PDF download/);
    await settle();
    assert.equal(calls, 1);
    finish({ url: `${url}.pdf`, bytes: 1234 });
    await settle();
    const result = service.get(job.downloadID);
    assert.equal(result.status, "complete");
    assert.equal(result.path, "/temp/job-1.pdf");
    assert.equal(result.sourceURL, `${url}.pdf`);
    assert.equal(result.bytes, 1234);
    assert.equal(result.pollAfterMs, null);
    assert.ok(Date.parse(result.expiresAt!) > Date.now());
    result.path = "/changed";
    assert.equal(service.get(job.downloadID).path, "/temp/job-1.pdf", "callers cannot mutate job state");
  });

  it("supports direct PDF URLs with interactive CAPTCHA disabled", async () => {
    const { service } = setup(async request => {
      assert.equal(request.kind, "pdf");
      assert.equal(request.allowCaptcha, false);
      return false;
    });
    const job = service.start({ url, kind: "pdf", allowCaptcha: false });
    await settle();
    assert.equal(service.get(job.downloadID).status, "not_found");
  });

  it("removes partial files after not-found and rejected downloads", async () => {
    for (const download of [async () => false as const, async () => { throw new Error("network failure"); }]) {
      const { service, removed } = setup(download);
      const job = service.start({ url });
      await settle();
      assert.ok(["not_found", "failed"].includes(service.get(job.downloadID).status));
      assert.equal(service.get(job.downloadID).path, null);
      assert.deepEqual(removed, ["/temp/job-1.pdf"]);
    }
  });

  it("expires completed files and their IDs after an hour", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const { service, removed } = setup();
    const job = service.start({ url });
    await settle();
    t.mock.timers.tick(DOWNLOAD_TTL_MS);
    await settle();
    assert.deepEqual(removed, ["/temp/job-1.pdf"]);
    assert.throws(() => service.get(job.downloadID), /expired/);
  });

  it("evicts the oldest finished job when retaining more than ten", async () => {
    const { service, removed } = setup();
    for (let index = 0; index < 11; index++) {
      service.start({ url });
      await settle();
    }
    assert.throws(() => service.get("job-1"), /not found/);
    assert.equal(service.get("job-11").status, "complete");
    assert.deepEqual(removed, ["/temp/job-1.pdf"]);
  });

  it("cleans a download that finishes after shutdown without racing its file writes", async () => {
    let finish!: (result: { url: string; bytes: number }) => void;
    const { service, removed } = setup(async () => new Promise(resolve => { finish = resolve; }));
    service.start({ url });
    await settle();
    service.stop();
    assert.deepEqual(removed, []);
    finish({ url, bytes: 100 });
    await settle();
    assert.deepEqual(removed, ["/temp/job-1.pdf"]);
    assert.throws(() => service.start({ url }), /stopped/);
  });

  it("rejects missing, non-web, credential-bearing and local URLs", () => {
    for (const value of [undefined, "", "file:///tmp/a.pdf", "https://user:password@example.com/a", "http://localhost/a", "http://localhost./a", "http://127.1/a", "http://192.168.1.1/a", "http://[::1]/a", "http://10.0.0.1/a"]) {
      assert.throws(() => downloadURL(value), { name: "ToolError" });
    }
    assert.equal(downloadURL("https://doi.org/10.1234/abc#fragment"), "https://doi.org/10.1234/abc");
  });
});
