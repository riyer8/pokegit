/**
 * Key storage. Never send raw secrets to the UI.
 *
 * Priority: secrets.local.js (gitignored, local-only) → chrome.storage.local
 * Uses local storage (not sync) so keys do not leave this machine via Chrome sync.
 */

const KEYS = ["githubToken", "openaiApiKey"];

let cachedLocal = null;

export async function loadLocalSecrets() {
  if (cachedLocal) return cachedLocal;
  try {
    const mod = await import("./secrets.local.js");
    const githubToken = sanitizeSecret(mod.GITHUB_TOKEN);
    const openaiApiKey = sanitizeSecret(mod.OPENAI_API_KEY);
    cachedLocal = { githubToken, openaiApiKey };
  } catch {
    cachedLocal = { githubToken: null, openaiApiKey: null };
  }
  return cachedLocal;
}

function sanitizeSecret(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v === "undefined" || v === "null") return null;
  return v;
}

async function readStored() {
  // Prefer device-local storage. Migrate once from sync if needed.
  const local = await chrome.storage.local.get(KEYS);
  if (local.githubToken || local.openaiApiKey) {
    return {
      githubToken: sanitizeSecret(local.githubToken),
      openaiApiKey: sanitizeSecret(local.openaiApiKey),
    };
  }

  try {
    const synced = await chrome.storage.sync.get(KEYS);
    const migrated = {
      githubToken: sanitizeSecret(synced.githubToken),
      openaiApiKey: sanitizeSecret(synced.openaiApiKey),
    };
    if (migrated.githubToken || migrated.openaiApiKey) {
      await chrome.storage.local.set(migrated);
      await chrome.storage.sync.remove(KEYS);
    }
    return migrated;
  } catch {
    return { githubToken: null, openaiApiKey: null };
  }
}

export async function getGithubToken() {
  const local = await loadLocalSecrets();
  if (local.githubToken) return local.githubToken;
  const stored = await readStored();
  return stored.githubToken;
}

export async function getOpenAIKey() {
  const local = await loadLocalSecrets();
  if (local.openaiApiKey) return local.openaiApiKey;
  const stored = await readStored();
  return stored.openaiApiKey;
}

/**
 * Safe status for the panel. Never includes raw key material.
 */
export async function getKeyStatus() {
  const local = await loadLocalSecrets();
  const stored = await readStored();

  const githubSource = local.githubToken ? "local" : stored.githubToken ? "storage" : "none";
  const openaiSource = local.openaiApiKey ? "local" : stored.openaiApiKey ? "storage" : "none";

  return {
    github: {
      present: githubSource !== "none",
      source: githubSource,
      hint: githubSource === "local" ? "from local .env" : githubSource === "storage" ? "saved on this device" : null,
    },
    openai: {
      present: openaiSource !== "none",
      source: openaiSource,
      hint: openaiSource === "local" ? "from local .env" : openaiSource === "storage" ? "saved on this device" : null,
    },
    usingLocalEnv: Boolean(local.githubToken || local.openaiApiKey),
  };
}

export async function saveStoredKeys({ githubToken, openaiApiKey }) {
  const patch = {};
  if (typeof githubToken === "string") {
    patch.githubToken = sanitizeSecret(githubToken);
  }
  if (typeof openaiApiKey === "string") {
    patch.openaiApiKey = sanitizeSecret(openaiApiKey);
  }
  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
    // Keep sync clear so keys are not uploaded to the Google account
    try {
      await chrome.storage.sync.remove(KEYS);
    } catch {
      /* ignore */
    }
  }
  return getKeyStatus();
}

export async function clearStoredKeys() {
  await chrome.storage.local.remove(KEYS);
  try {
    await chrome.storage.sync.remove(KEYS);
  } catch {
    /* ignore */
  }
  return getKeyStatus();
}
