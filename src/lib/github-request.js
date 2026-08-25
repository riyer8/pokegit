import { getGithubToken } from "./secrets.js";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(message, status, rateLimitRemaining = null) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.rateLimitRemaining = rateLimitRemaining;
  }
}

export async function request(path, options = {}) {
  const token = await getGithubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "PokeGit-Extension",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API}${path}`, { ...options, headers });
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
