/** Zotero 11 download-only API, checked at db41b99f. Never call addFileFromURLs or any Item save method. */
import { FulltextDownloads } from "../tools/fulltext-download.js";
import { publisherChallengeCallbacks, type ChallengeBrowser } from "../tools/publisher-challenge.js";
import { ToolError } from "../tools/types.js";

interface DownloadAPI {
  downloadFirstAvailableFile(resolvers: Array<{ url?: string; pageURL?: string }>, path: string, options: {
    enforceFileType: boolean;
    shouldDisplayCaptcha: boolean;
    onBeforeRequest(url: string): Promise<void>;
    onRequestError(error: unknown): boolean;
  }): Promise<{ url: string } | false>;
}

export function createFulltextDownloads(): FulltextDownloads {
  return new FulltextDownloads({
    id: () => Services.uuid.generateUUID().toString().slice(1, -1),
    allocate: async id => PathUtils.join(PathUtils.tempDir, `zotero-reading-bridge-${id}.pdf`),
    download: async (request, path) => {
      const api = Zotero.Attachments as unknown as DownloadAPI;
      if (typeof api.downloadFirstAvailableFile !== "function") {
        throw new ToolError("UNAVAILABLE", "This Zotero version lacks the download-only API. Update Zotero and retry.");
      }
      const browser = (Zotero as unknown as { BrowserRequest?: ChallengeBrowser }).BrowserRequest;
      const callbacks = publisherChallengeCallbacks(
        typeof browser?.clearChallenge === "function" ? browser : undefined, request.allowCaptcha,
      );
      const result = await api.downloadFirstAvailableFile(
        [request.kind === "pdf" ? { url: request.url } : { pageURL: request.url }], path,
        {
          enforceFileType: true,
          shouldDisplayCaptcha: request.allowCaptcha,
          onBeforeRequest: callbacks.onBeforeRequest,
          onRequestError: callbacks.onRequestError,
        },
      );
      if (!result) {
        const failure = callbacks.failure();
        if (failure) throw failure;
        return false;
      }
      // Zotero's API also accepts EPUB; this tool promises an actual PDF, including browser fallback results.
      const sample = await IOUtils.read(path, { maxBytes: 1024 });
      if (Zotero.MIME.sniffForMIMEType(String.fromCharCode(...sample)) !== "application/pdf") {
        throw new ToolError("UNAVAILABLE", "The response was not a PDF (it may be an HTML login page or EPUB).");
      }
      const bytes = (await IOUtils.stat(path)).size;
      if (bytes === undefined || bytes === 0) throw new ToolError("UNAVAILABLE", "The downloaded PDF is empty or unreadable.");
      return { url: result.url, bytes };
    },
    remove: path => IOUtils.remove(path, { ignoreAbsent: true }),
    log: error => Zotero.logError(error instanceof Error ? error : new Error(String(error))),
  });
}
