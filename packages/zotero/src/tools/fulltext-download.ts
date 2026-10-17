/** Background PDF downloads: no Zotero items are created, and callers cannot choose a destination path. */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import type { FulltextDownload } from "../../../../shared/types/tools.js";
import { json, ToolError, type ToolArgs, type ToolHandler } from "./types.js";

export const DOWNLOAD_TTL_MS = 60 * 60 * 1000;
const MAX_JOBS = 10;

export interface DownloadRequest {
  url: string;
  kind: "page" | "pdf";
  allowCaptcha: boolean;
}

/** This is an input guard, not a network sandbox: Zotero manages redirects and browser subresources. */
export function downloadURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new ToolError("INVALID_ARGUMENT", "Provide a public HTTP(S) article or PDF URL.");
  let url: URL;
  try { url = new URL(value); } catch { throw new ToolError("INVALID_ARGUMENT", "Invalid article or PDF URL."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || !host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local")
    || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    throw new ToolError("INVALID_ARGUMENT", "Use a public HTTP(S) publisher URL without embedded credentials.");
  }
  url.hash = "";
  return url.href;
}

export interface DownloadBackend {
  id(): string;
  allocate(id: string): Promise<string>;
  download(request: DownloadRequest, path: string): Promise<{ url: string; bytes: number } | false>;
  remove(path: string): Promise<void>;
  log(error: unknown): void;
}

interface Job {
  request: DownloadRequest;
  result: FulltextDownload;
  file: string | null;
  timer?: ReturnType<typeof setTimeout>;
}

export class FulltextDownloads {
  private jobs = new Map<string, Job>();
  private stopped = false;
  constructor(private backend: DownloadBackend) {}

  readonly handlers = {
    download_fulltext: async (args: ToolArgs) => json(this.start(args)),
    get_fulltext_download: async (args: ToolArgs) => json(this.get(String(args.downloadID))),
  } satisfies Partial<Record<ToolName, ToolHandler>>;

  start(args: ToolArgs): FulltextDownload {
    if (this.stopped) throw new ToolError("UNAVAILABLE", "The download service has stopped.");
    const request: DownloadRequest = {
      url: downloadURL(args.url),
      kind: args.kind === undefined ? "page" : args.kind as DownloadRequest["kind"],
      allowCaptcha: args.allowCaptcha === undefined ? true : args.allowCaptcha as boolean,
    };
    if (!["page", "pdf"].includes(request.kind) || typeof request.allowCaptcha !== "boolean") {
      throw new ToolError("INVALID_ARGUMENT", "Invalid download options.");
    }
    for (const job of this.jobs.values()) {
      if (job.result.status === "running") {
        if (JSON.stringify(job.request) === JSON.stringify(request)) return { ...job.result };
        throw new ToolError("UNAVAILABLE", "Another PDF download is running. Check it before starting another.", { downloadID: job.result.downloadID });
      }
    }
    if (this.jobs.size >= MAX_JOBS) {
      const oldest = this.jobs.values().next().value as Job;
      this.forget(oldest);
    }
    const id = this.backend.id();
    const job: Job = {
      request, file: null,
      result: {
        downloadID: id, status: "running", requestedURL: request.url, sourceURL: null,
        path: null, bytes: null, expiresAt: null, pollAfterMs: 2000,
        note: request.allowCaptcha
          ? "Zotero may open a publisher CAPTCHA window. Ask the user to complete it in Zotero; query this download ID for progress."
          : "Downloading without interactive CAPTCHA windows; query this download ID for progress.",
      },
    };
    this.jobs.set(id, job);
    void this.run(job);
    return { ...job.result };
  }

  get(id: string): FulltextDownload {
    const job = this.jobs.get(id);
    if (!job) throw new ToolError("NOT_FOUND", "Download not found (expired, evicted, or Zotero/plugin restarted).");
    return { ...job.result };
  }

  private async run(job: Job): Promise<void> {
    try {
      job.file = await this.backend.allocate(job.result.downloadID);
      if (this.stopped) return;
      const result = await this.backend.download(job.request, job.file);
      if (this.stopped) return;
      if (result) {
        Object.assign(job.result, {
          status: "complete", sourceURL: result.url, path: job.file, bytes: result.bytes,
          note: "Read this temporary PDF with your own file-reading tools. It is on Zotero's computer, not in the library. Verify the paper's identity before citing it. Copy it if needed beyond expiry.",
        });
      } else {
        job.result.status = "not_found";
        job.result.note = "Zotero found no downloadable PDF. Check campus network/VPN access and any publisher CAPTCHA window. Do not assume full text was read or repeatedly retry unchanged access.";
      }
    } catch (error) {
      job.result.status = "failed";
      job.result.note = error instanceof ToolError ? error.message : "PDF download failed. Check Zotero, network access, and any publisher CAPTCHA window before retrying.";
      this.backend.log(error);
    } finally {
      if (this.stopped || job.result.status !== "complete") await this.remove(job);
      if (!this.stopped) {
        job.result.pollAfterMs = null;
        job.result.expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MS).toISOString();
        job.timer = setTimeout(() => this.forget(job), DOWNLOAD_TTL_MS);
      }
    }
  }

  private async remove(job: Job): Promise<void> {
    if (!job.file) return;
    try { await this.backend.remove(job.file); job.file = null; } catch (error) { this.backend.log(error); }
  }

  private forget(job: Job): void {
    if (job.timer) clearTimeout(job.timer);
    this.jobs.delete(job.result.downloadID);
    void this.remove(job);
  }

  stop(): void {
    this.stopped = true;
    for (const job of this.jobs.values()) {
      // Native Zotero downloads cannot be cancelled here. Clean active files only after they settle.
      if (job.result.status !== "running") this.forget(job);
    }
    this.jobs.clear();
  }
}
