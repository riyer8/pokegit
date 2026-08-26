import { analyzeProfile, GitHubError } from "./lib/analyze.js";
import { analyzeRepoPage } from "./lib/repo-page.js";
import { getKeyStatus, saveStoredKeys, clearStoredKeys } from "./lib/secrets.js";
import { compareProfiles } from "./lib/compare.js";
import { buildImprovements, generateSteerStarters } from "./lib/improve.js";
import { buildCompareSuggestionPool } from "./lib/compare-suggest.js";
import { fetchContributionPulse } from "./lib/contributions.js";
import { request, isSafeGithubLogin, isSafeGithubRepoName } from "./lib/github-request.js";
import { redactSecrets } from "./lib/secret-safety.js";
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

const ALLOWED_TYPES = new Set([
  "POKEGIT_ANALYZE_PROFILE",
  "POKEGIT_FETCH_PROFILE",
  "POKEGIT_ANALYZE_REPO",
  "POKEGIT_COMPARE_PROFILES",
  "POKEGIT_GET_COMPARE_SUGGESTIONS",
  "POKEGIT_REFRESH_STARTERS",
  "POKEGIT_GET_HISTORY",
  "POKEGIT_GET_KEY_STATUS",
  "POKEGIT_SAVE_KEYS",
  "POKEGIT_CLEAR_KEYS",
  "POKEGIT_CLEAR_CACHE",
]);

const KEY_WRITE_TYPES = new Set(["POKEGIT_SAVE_KEYS", "POKEGIT_CLEAR_KEYS"]);

function isOwnExtension(sender) {
  return Boolean(sender?.id && sender.id === chrome.runtime.id);
}

function isGithubContentScript(sender) {
  if (!isOwnExtension(sender)) return false;
  const url = String(sender.url || "");
  const origin = String(sender.origin || "");
  return url.startsWith("https://github.com/") || origin === "https://github.com";
}

function safeError(err) {
  return redactSecrets(err?.message || "Something went wrong");
}

function publicError(err) {
  return {
    message: safeError(err),
    status: err?.status || 0,
    rateLimitRemaining: err?.rateLimitRemaining ?? null,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isOwnExtension(sender) || !ALLOWED_TYPES.has(message?.type)) {
    sendResponse({ ok: false, error: "Unauthorized" });
    return false;
  }

  if (KEY_WRITE_TYPES.has(message.type) && !isGithubContentScript(sender)) {
    sendResponse({ ok: false, error: "Unauthorized" });
    return false;
  }

  if (message.type === "POKEGIT_ANALYZE_PROFILE" || message.type === "POKEGIT_FETCH_PROFILE") {
    handleAnalyze(message.username, Boolean(message.force))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: publicError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_ANALYZE_REPO") {
    handleAnalyzeRepo(message.owner, message.repo, Boolean(message.force))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: publicError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_COMPARE_PROFILES") {
    handleCompare(message.leftUsername, message.rightUsername, Boolean(message.force))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: publicError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_GET_COMPARE_SUGGESTIONS") {
    handleCompareSuggestions(message.viewerLogin)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_REFRESH_STARTERS") {
    handleRefreshStarters(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_GET_HISTORY") {
    loadHistory()
      .then((history) => sendResponse({ ok: true, history }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_GET_KEY_STATUS") {
    getKeyStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_SAVE_KEYS") {
    const githubToken = message.githubToken;
    const openaiApiKey = message.openaiApiKey;
    message.githubToken = undefined;
    message.openaiApiKey = undefined;
    saveStoredKeys({ githubToken, openaiApiKey })
      .then(async (status) => {
        memoryCache.clear();
        await clearPayloadCache();
        sendResponse({ ok: true, status });
      })
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_CLEAR_KEYS") {
    clearStoredKeys()
      .then(async (status) => {
        memoryCache.clear();
        await clearPayloadCache();
        sendResponse({ ok: true, status });
      })
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  if (message.type === "POKEGIT_CLEAR_CACHE") {
    memoryCache.clear();
    clearPayloadCache()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: safeError(err) }));
    return true;
  }

  sendResponse({ ok: false, error: "Unauthorized" });
  return false;
});

function withImprovements(payload) {
  if (!payload || payload.insufficient) return payload;
  if (!payload.improvements) {
    try {
      payload.improvements = buildImprovements(payload);
    } catch {
      /* ignore */
    }
  }
  return payload;
}

async function handleAnalyze(username, force = false) {
  if (!isSafeGithubLogin(username)) {
    throw new GitHubError("Missing username", 400);
  }

  const key = username.toLowerCase();

  if (!force) {
    const mem = memoryCache.get(key);
    if (mem && Date.now() - mem.at < MEMORY_TTL_MS) {
      await rememberAnalysis(mem.payload, { fromCache: true });
      return {
        payload: {
          ...withImprovements(mem.payload),
          fromCache: true,
          cacheAgeMs: Date.now() - mem.at,
        },
        fromCache: true,
      };
    }
    const disk = await getCachedPayload(key);
    if (disk?.payload) {
      memoryCache.set(key, { at: disk.at, payload: disk.payload });
      await rememberAnalysis(disk.payload, { fromCache: true });
      return {
        payload: {
          ...withImprovements(disk.payload),
          fromCache: true,
          cacheAgeMs: disk.ageMs,
        },
        fromCache: true,
      };
    }
  }

  const previous = force ? (await getCachedPayload(key))?.payload : null;
  const payload = withImprovements(await analyzeProfile(key));
  payload.previousAnalyzedAt = previous?.analyzedAt || previous?.fetchedAt || null;
  payload.fromCache = false;

  memoryCache.set(key, { at: Date.now(), payload });
  await setCachedPayload(key, payload);
  await rememberAnalysis(payload, { fromCache: false });

  return { payload, fromCache: false, cacheTtlMs: PERSIST_TTL_MS };
}

async function handleAnalyzeRepo(owner, repo, force = false) {
  if (!isSafeGithubLogin(owner) || !isSafeGithubRepoName(repo)) {
    throw new GitHubError("Missing owner/repo", 400);
  }
  const key = `repo:${owner}/${repo}`.toLowerCase();

  if (!force) {
    const mem = memoryCache.get(key);
    if (mem && Date.now() - mem.at < MEMORY_TTL_MS) {
      return {
        payload: { ...mem.payload, fromCache: true, cacheAgeMs: Date.now() - mem.at },
        fromCache: true,
      };
    }
    const disk = await getCachedPayload(key);
    if (disk?.payload) {
      memoryCache.set(key, { at: disk.at, payload: disk.payload });
      return {
        payload: { ...disk.payload, fromCache: true, cacheAgeMs: disk.ageMs },
        fromCache: true,
      };
    }
  }

  const previous = force ? (await getCachedPayload(key))?.payload : null;
  const payload = await analyzeRepoPage(owner, repo);
  payload.previousAnalyzedAt = previous?.analyzedAt || previous?.fetchedAt || null;
  payload.fromCache = false;

  memoryCache.set(key, { at: Date.now(), payload });
  await setCachedPayload(key, payload);

  return { payload, fromCache: false, cacheTtlMs: PERSIST_TTL_MS };
}

async function handleCompareSuggestions(viewerLogin) {
  const login = String(viewerLogin || "").trim();
  if (!isSafeGithubLogin(login)) return { pool: [] };

  const cacheKey = `following:${login.toLowerCase()}`;
  const mem = memoryCache.get(cacheKey);
  if (mem && Date.now() - mem.at < MEMORY_TTL_MS) {
    return { pool: mem.payload };
  }

  let following = [];
  try {
    const { data } = await request(
      `/users/${encodeURIComponent(login)}/following?per_page=100`
    );
    if (Array.isArray(data)) {
      following = data.map((u) => ({
        login: u.login,
        avatarUrl: u.avatar_url || null,
        name: u.name || null,
      }));
    }
  } catch {
    following = [];
  }

  const pool = buildCompareSuggestionPool({ viewerLogin: login, following });
  memoryCache.set(cacheKey, { at: Date.now(), payload: pool });
  return { pool };
}

async function handleRefreshStarters(message) {
  const username = String(message?.username || "").trim();
  if (!isSafeGithubLogin(username)) throw new GitHubError("Missing username", 400);
  const { payload } = await handleAnalyze(username, false);
  if (!payload || payload.insufficient) {
    throw new GitHubError("Not enough public signal to invent starters", 400);
  }
  return generateSteerStarters(payload, {
    steer: message.steer || "",
    seed: Number(message.seed) || 0,
    excludeTitles: Array.isArray(message.previousTitles) ? message.previousTitles : [],
  });
}

async function handleCompare(leftUsername, rightUsername, force = false) {
  if (!isSafeGithubLogin(leftUsername) || !isSafeGithubLogin(rightUsername)) {
    throw new GitHubError("Need two usernames to compare", 400);
  }
  if (leftUsername.toLowerCase() === rightUsername.toLowerCase()) {
    throw new GitHubError("Pick two different profiles to compare", 400);
  }

  const [leftRes, rightRes, leftPulse, rightPulse] = await Promise.all([
    handleAnalyze(leftUsername, force),
    handleAnalyze(rightUsername, force),
    fetchContributionPulse(leftUsername),
    fetchContributionPulse(rightUsername),
  ]);

  const leftPayload = { ...leftRes.payload, contributionPulse: leftPulse };
  const rightPayload = { ...rightRes.payload, contributionPulse: rightPulse };
  const comparison = compareProfiles(leftPayload, rightPayload);
  return {
    comparison,
    left: leftPayload,
    right: rightPayload,
    fromCache: Boolean(leftRes.fromCache && rightRes.fromCache),
  };
}
