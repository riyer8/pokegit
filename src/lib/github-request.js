import { getGithubToken } from "./secrets.js";
import { redactSecrets } from "./secret-safety.js";

const API = "https://api.github.com";
const PATH_RE = /^\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*$/;

export class GitHubError extends Error {
  constructor(message, status, rateLimitRemaining = null) {
    super(redactSecrets(message));
    this.name = "GitHubError";
    this.status = status;
    this.rateLimitRemaining = rateLimitRemaining;
  }
}

export function isSafeGithubPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("://")) {
    return false;
  }
  if (path.includes("..") || /[\s\\]/.test(path)) return false;
  if (/%2e%2e/i.test(path) || /%3a/i.test(path)) return false;
  return PATH_RE.test(path);
}

export function isSafeGithubLogin(value) {
  return typeof value === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value);
}

export function isSafeGithubRepoName(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(value);
}

export async function request(path, options = {}) {
  if (!isSafeGithubPath(path)) {
    throw new GitHubError("Invalid GitHub path", 400);
  }

  const token = await getGithubToken();
  const { headers: extraHeaders, ...rest } = options;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "PokeGit-Extension",
    ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
  };
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "authorization") delete headers[key];
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...rest, headers });
  const remaining = res.headers.get("X-RateLimit-Remaining");

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.message || detail;
    } catch {
      /* ignore */
    }
    throw new GitHubError(detail, res.status, remaining);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { data, rateLimitRemaining: remaining, headers: res.headers };
}
