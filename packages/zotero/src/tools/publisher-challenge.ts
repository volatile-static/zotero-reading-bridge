import { downloadURL } from "./fulltext-download.js";
import { ToolError } from "./types.js";

export interface ChallengeBrowser {
  getEntryForURL(url: string): object | null;
  clearChallenge(url: string, options: { entry: object; allowViewer: boolean }): Promise<void>;
}

/** Zotero's request-error hook is synchronous. Request a retry there, then await verification in beforeRequest. */
export function publisherChallengeCallbacks(browser: ChallengeBrowser | undefined, allowViewer: boolean) {
  let lastURL: string | null = null;
  let pending: { url: string; entry: object } | null = null;
  let failure: Error | null = null;
  const attempted = new Set<string>();
  return {
    async onBeforeRequest(url: string): Promise<void> {
      downloadURL(url);
      lastURL = url;
      const challenge = pending;
      pending = null;
      if (challenge && browser) {
        try {
          await browser.clearChallenge(challenge.url, { entry: challenge.entry, allowViewer });
        } catch {
          failure = new ToolError("UNAVAILABLE", allowViewer
            ? "Publisher verification did not complete. Check the Zotero CAPTCHA window and institutional access before retrying."
            : "Publisher verification could not complete without an interactive window. Retry with allowCaptcha enabled if appropriate.");
          throw failure;
        }
      }
    },
    onRequestError(error: unknown): boolean {
      if (!browser || !lastURL || attempted.has(lastURL)
        || typeof error !== "object" || error === null || !("status" in error) || error.status !== 403) return false;
      const entry = browser.getEntryForURL(lastURL);
      if (!entry) return false;
      attempted.add(lastURL);
      pending = { url: lastURL, entry };
      return true;
    },
    failure: () => failure,
  };
}
