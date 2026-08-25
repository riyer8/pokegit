/**
 * Local analysis history for PokéGit (chrome.storage.local only).
 * No backend. Never invents history PokéGit did not capture.
 */

const HISTORY_KEY = "pokegit_history_v1";
const CACHE_KEY = "pokegit_payload_cache_v1";
const MAX_HISTORY = 12;
const MAX_CACHE_ENTRIES = 20;
export const PERSIST_TTL_MS = 6 * 60 * 60 * 1000; // 6h warm cache

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

export async function loadHistory() {
  const data = await storageGet([HISTORY_KEY]);
  return Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
}

export async function rememberAnalysis(payload, { fromCache = false } = {}) {
  if (!payload?.user?.login) return;
  const login = payload.user.login;
  const analyzedAt = payload.analyzedAt || payload.fetchedAt || new Date().toISOString();
  const entry = {
    login,
    analyzedAt,
    archetype: payload.glance?.headline || payload.summary?.glanceHeadline || "",
    fromCache: Boolean(fromCache),
    avatarUrl: payload.user.avatarUrl || "",
  };

  const history = await loadHistory();
  const next = [entry, ...history.filter((h) => h.login.toLowerCase() !== login.toLowerCase())].slice(
    0,
    MAX_HISTORY
  );
  await storageSet({ [HISTORY_KEY]: next });
  return next;
}

export async function getCachedPayload(username) {
  const key = String(username || "").toLowerCase();
  if (!key) return null;
  const data = await storageGet([CACHE_KEY]);
  const map = data[CACHE_KEY] || {};
  const hit = map[key];
  if (!hit?.payload || !hit.at) return null;
  if (Date.now() - hit.at > PERSIST_TTL_MS) return null;
  return { payload: hit.payload, at: hit.at, ageMs: Date.now() - hit.at };
}

export async function setCachedPayload(username, payload) {
  const key = String(username || "").toLowerCase();
  if (!key || !payload) return;
  const data = await storageGet([CACHE_KEY]);
  const map = { ...(data[CACHE_KEY] || {}) };
  map[key] = { at: Date.now(), payload };
  // prune oldest
  const entries = Object.entries(map).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const pruned = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
  await storageSet({ [CACHE_KEY]: pruned });
}

export async function clearPayloadCache() {
  await storageSet({ [CACHE_KEY]: {} });
}
