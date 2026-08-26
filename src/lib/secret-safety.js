/**
 * Token shape checks and redaction. Never log or return raw secrets.
 */

const GITHUB_TOKEN_RE = /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,255}$|^github_pat_[A-Za-z0-9_]{20,255}$/;
const OPENAI_KEY_RE = /^sk-[A-Za-z0-9_-]{20,400}$/;

const SECRET_PATTERNS = [
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+\S+/gi,
];

export function redactSecrets(value) {
  let text = String(value ?? "");
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    text = text.replace(re, "[redacted]");
  }
  return text;
}

export function isPlausibleGithubToken(value) {
  return typeof value === "string" && GITHUB_TOKEN_RE.test(value.trim());
}

export function isPlausibleOpenAIKey(value) {
  return typeof value === "string" && OPENAI_KEY_RE.test(value.trim());
}
