import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publisherChallengeCallbacks } from "../../packages/zotero/src/tools/publisher-challenge.js";

const url = "https://www.sciencedirect.com/science/article/pii/example";
const entry = { captchaLocator: "#captcha-box" };

describe("publisher page verification", () => {
  it("waits for human verification before retrying a recognized 403, and tries only once", async () => {
    let finish!: () => void;
    let shown = 0;
    const callbacks = publisherChallengeCallbacks({
      getEntryForURL: () => entry,
      clearChallenge: async (requestedURL, options) => {
        shown++;
        assert.equal(requestedURL, url);
        assert.deepEqual(options, { entry, allowViewer: true });
        await new Promise<void>(resolve => { finish = resolve; });
      },
    }, true);
    await callbacks.onBeforeRequest(url);
    assert.equal(callbacks.onRequestError({ status: 403 }), true);
    assert.equal(shown, 0, "synchronous error callback must not start an unawaited verification");
    let ready = false;
    const retry = callbacks.onBeforeRequest(url).then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(ready, false);
    assert.equal(shown, 1);
    finish();
    await retry;
    assert.equal(ready, true);
    assert.equal(callbacks.onRequestError({ status: 403 }), false);
  });

  it("preserves cancelled/failed verification as a failure instead of reporting no PDF", async () => {
    const callbacks = publisherChallengeCallbacks({
      getEntryForURL: () => entry,
      clearChallenge: async () => { throw new Error("User closed viewer"); },
    }, true);
    await callbacks.onBeforeRequest(url);
    assert.equal(callbacks.onRequestError({ status: 403 }), true);
    await assert.rejects(callbacks.onBeforeRequest(url), /verification did not complete/);
    assert.match(callbacks.failure()!.message, /CAPTCHA/);
    assert.equal(callbacks.onRequestError(callbacks.failure()), false);
  });

  it("honors disabled interaction and ignores unrecognized sites and unrelated errors", async () => {
    const callbacks = publisherChallengeCallbacks({
      getEntryForURL: requestedURL => requestedURL === url ? entry : null,
      clearChallenge: async (_url, options) => { assert.equal(options.allowViewer, false); },
    }, false);
    await callbacks.onBeforeRequest("https://example.com/article");
    assert.equal(callbacks.onRequestError({ status: 403 }), false);
    await callbacks.onBeforeRequest(url);
    for (const error of [null, new Error("timeout"), { status: 404 }, { status: 429 }, { status: 500 }]) {
      assert.equal(callbacks.onRequestError(error), false);
    }
    assert.equal(callbacks.onRequestError({ status: 403 }), true);
    await callbacks.onBeforeRequest(url);
    const unsupported = publisherChallengeCallbacks(undefined, true);
    await unsupported.onBeforeRequest(url);
    assert.equal(unsupported.onRequestError({ status: 403 }), false);
  });
});
