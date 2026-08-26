/**
 * Key storage. Never send raw secrets to the UI. Never hardcode keys in source.
 *
 * Most secure place for a Chrome extension: chrome.storage.local on this device.
 * Not a .js / .env file in the repo. Those files ship with "Load unpacked"
 * and leak if you zip, commit, or upload the folder.
 *
 * Not chrome.storage.sync, so keys are not uploaded to the Google account.
 * The service worker is the only code that reads the raw values, and only to
 * call GitHub / OpenAI. The panel only learns whether a key is present.
 */

const KEYS = ["githubToken", "openaiApiKey"];

function sanitizeSecret(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v === "undefined" || v === "null") return null;
  return v;
}

async function readStored() {
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
  const stored = await readStored();
  return stored.githubToken;
}

export async function getOpenAIKey() {
  const stored = await readStored();
  return stored.openaiApiKey;
}

function keyView(present) {
  return {
    present,
    source: present ? "storage" : "none",
    hint: present ? "saved on this device" : null,
  };
}

/**
 * Safe status for the panel. Never includes raw key material.
 */
export async function getKeyStatus() {
  const stored = await readStored();
  return {
    github: keyView(Boolean(stored.githubToken)),
    openai: keyView(Boolean(stored.openaiApiKey)),
  };
}

export async function saveStoredKeys({ githubToken, openaiApiKey }) {
  const patch = {};
  const gh = sanitizeSecret(githubToken);
  const oa = sanitizeSecret(openaiApiKey);
  if (gh) patch.githubToken = gh;
  if (oa) patch.openaiApiKey = oa;
  if (!Object.keys(patch).length) return getKeyStatus();

  await chrome.storage.local.set(patch);
  try {
    await chrome.storage.sync.remove(KEYS);
  } catch {
    /* ignore */
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
