/**
 * Compare-tab suggestions: the logged-in viewer, then people they follow.
 * Pure helpers so the content script can mirror the same ranking.
 */

export const COMPARE_SUGGEST_LIMIT = 5;

export function githubAvatarUrl(login) {
  if (!login) return "";
  return `https://github.com/${encodeURIComponent(login)}.png?size=80`;
}

export function buildCompareSuggestionPool({ viewerLogin, following = [] } = {}) {
  const seen = new Set();
  const pool = [];
  const viewer = String(viewerLogin || "").trim();
  if (viewer) {
    seen.add(viewer.toLowerCase());
    pool.push({
      login: viewer,
      name: null,
      avatarUrl: githubAvatarUrl(viewer),
      kind: "you",
    });
  }
  for (const raw of following) {
    const login = String(raw?.login || "").trim();
    if (!login) continue;
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push({
      login,
      name: raw.name || null,
      avatarUrl: raw.avatarUrl || githubAvatarUrl(login),
      kind: "following",
    });
  }
  return pool;
}

export function filterCompareSuggestions(
  pool,
  { query = "", excludeLogin = "", limit = COMPARE_SUGGEST_LIMIT } = {}
) {
  const q = String(query || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const exclude = String(excludeLogin || "")
    .trim()
    .toLowerCase();

  let list = (pool || []).filter((u) => u?.login && u.login.toLowerCase() !== exclude);

  if (q) {
    list = list.filter((u) => {
      const login = u.login.toLowerCase();
      const name = String(u.name || "").toLowerCase();
      return login.includes(q) || name.includes(q);
    });
    list.sort((a, b) => {
      const aLogin = a.login.toLowerCase();
      const bLogin = b.login.toLowerCase();
      const aPrefix = aLogin.startsWith(q) ? 0 : 1;
      const bPrefix = bLogin.startsWith(q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      if (a.kind === "you" && b.kind !== "you") return -1;
      if (b.kind === "you" && a.kind !== "you") return 1;
      return aLogin.localeCompare(bLogin);
    });
  }

  return list.slice(0, Math.max(0, Number(limit) || COMPARE_SUGGEST_LIMIT));
}
