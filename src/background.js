import { analyzeProfile, GitHubError } from "./lib/analyze.js";
import { getKeyStatus, saveStoredKeys, clearStoredKeys } from "./lib/secrets.js";
import { buildShareText } from "./lib/share.js";

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from this extension (content scripts / our pages)
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "Unauthorized" });
    return false;
  }

  if (message?.type === "POKEGIT_ANALYZE_PROFILE" || message?.type === "POKEGIT_FETCH_PROFILE") {
    handleAnalyze(message.username, Boolean(message.force))
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: {
            message: err.message || "Failed to analyze profile",
            status: err.status || 0,
            rateLimitRemaining: err.rateLimitRemaining ?? null,
          },
        })
      );
    return true;
  }

  if (message?.type === "POKEGIT_BUILD_SHARE") {
    try {
      const text = buildShareText(message.payload);
      sendResponse({ ok: true, text });
    } catch (err) {
      sendResponse({ ok: false, error: safeError(err) });
    }
    return false;
  }

  if (message?.type === "POKEGIT_GET_KEY_STATUS") {
    getKeyStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message?.type === "POKEGIT_SAVE_KEYS") {
    saveStoredKeys({
      githubToken: message.githubToken,
      openaiApiKey: message.openaiApiKey,
    })
      .then((status) => {
        cache.clear();
        sendResponse({ ok: true, status });
      })
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message?.type === "POKEGIT_CLEAR_KEYS") {
    clearStoredKeys()
      .then((status) => {
        cache.clear();
        sendResponse({ ok: true, status });
      })
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message?.type === "POKEGIT_CLEAR_CACHE") {
    cache.clear();
    sendResponse({ ok: true });
    return false;
  }
});

function safeError(err) {
  return err?.message || "Something went wrong";
}

async function handleAnalyze(username, force = false) {
  if (!username || typeof username !== "string") {
    throw new GitHubError("Missing username", 400);
  }

  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.payload;
  }

  const payload = await analyzeProfile(key);
  cache.set(key, { at: Date.now(), payload });
  return payload;
}
