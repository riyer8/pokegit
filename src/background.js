import { analyzeProfile, GitHubError } from "./lib/analyze.js";
import { getKeyStatus, saveStoredKeys, clearStoredKeys } from "./lib/secrets.js";
import { compareProfiles } from "./lib/compare.js";
import {
  getCachedPayload,
  setCachedPayload,
  rememberAnalysis,
  loadHistory,
  clearPayloadCache,
  PERSIST_TTL_MS,
} from "./lib/history.js";

const memoryCache = new Map();
const MEMORY_TTL_MS = 15 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "Unauthorized" });
    return false;
  }

  if (message?.type === "POKEGIT_ANALYZE_PROFILE" || message?.type === "POKEGIT_FETCH_PROFILE") {
    handleAnalyze(message.username, Boolean(message.force))
      .then((result) => sendResponse({ ok: true, ...result }))
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

  if (message?.type === "POKEGIT_COMPARE_PROFILES") {
    handleCompare(message.leftUsername, message.rightUsername, Boolean(message.force))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: {
            message: err.message || "Compare failed",
            status: err.status || 0,
          },
        })
      );
    return true;
  }

  if (message?.type === "POKEGIT_GET_HISTORY") {
    loadHistory()
      .then((history) => sendResponse({ ok: true, history }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
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
      .then(async (status) => {
        memoryCache.clear();
        await clearPayloadCache();
        sendResponse({ ok: true, status });
      })
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message?.type === "POKEGIT_CLEAR_KEYS") {
    clearStoredKeys()
      .then(async (status) => {
        memoryCache.clear();
        await clearPayloadCache();
        sendResponse({ ok: true, status });
      })
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message?.type === "POKEGIT_CLEAR_CACHE") {
    memoryCache.clear();
    clearPayloadCache()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
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

  if (!force) {
    const mem = memoryCache.get(key);
    if (mem && Date.now() - mem.at < MEMORY_TTL_MS) {
      await rememberAnalysis(mem.payload, { fromCache: true });
      return {
        payload: { ...mem.payload, fromCache: true, cacheAgeMs: Date.now() - mem.at },
        fromCache: true,
      };
    }
    const disk = await getCachedPayload(key);
    if (disk?.payload) {
      memoryCache.set(key, { at: disk.at, payload: disk.payload });
      await rememberAnalysis(disk.payload, { fromCache: true });
      return {
        payload: {
          ...disk.payload,
          fromCache: true,
          cacheAgeMs: disk.ageMs,
        },
        fromCache: true,
      };
    }
  }

  const previous = force ? (await getCachedPayload(key))?.payload : null;
  const payload = await analyzeProfile(key);
  payload.previousAnalyzedAt = previous?.analyzedAt || previous?.fetchedAt || null;
  payload.fromCache = false;

  memoryCache.set(key, { at: Date.now(), payload });
  await setCachedPayload(key, payload);
  await rememberAnalysis(payload, { fromCache: false });

  return { payload, fromCache: false, cacheTtlMs: PERSIST_TTL_MS };
}

async function handleCompare(leftUsername, rightUsername, force = false) {
  if (!leftUsername || !rightUsername) {
    throw new GitHubError("Need two usernames to compare", 400);
  }
  if (leftUsername.toLowerCase() === rightUsername.toLowerCase()) {
    throw new GitHubError("Pick two different profiles to compare", 400);
  }

  const [leftRes, rightRes] = await Promise.all([
    handleAnalyze(leftUsername, force),
    handleAnalyze(rightUsername, force),
  ]);

  const comparison = compareProfiles(leftRes.payload, rightRes.payload);
  return {
    comparison,
    left: leftRes.payload,
    right: rightRes.payload,
    fromCache: Boolean(leftRes.fromCache && rightRes.fromCache),
  };
}
