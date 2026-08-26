/**
 * Key storage. Never send raw secrets to the UI. Never hardcode keys in source.
 *
 * Keys live only in chrome.storage.local on this device (not sync).
 * The service worker is the only code that reads raw values, and only to
 * call GitHub / OpenAI through github-request / openai-request.
 */

import { isPlausibleGithubToken, isPlausibleOpenAIKey } from "./secret-safety.js";

const KEYS = ["githubToken", "openaiApiKey"];

function sanitizeSecret(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v === "undefined" || v === "null") return null;
  return v;
}

function acceptedGithubToken(value) {
  const v = sanitizeSecret(value);
  return v && isPlausibleGithubToken(v) ? v : null;
}

function acceptedOpenAIKey(value) {
  const v = sanitizeSecret(value);
  return v && isPlausibleOpenAIKey(v) ? v : null;
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

export async function getKeyStatus() {
  const stored = await readStored();
  return {
    github: keyView(Boolean(stored.githubToken)),
    openai: keyView(Boolean(stored.openaiApiKey)),
  };
}

export async function saveStoredKeys({ githubToken, openaiApiKey }) {
  const patch = {};
  if (typeof githubToken === "string" && githubToken.trim()) {
    const gh = acceptedGithubToken(githubToken);
    if (!gh) {
      const err = new Error("That GitHub token doesn't look valid.");
      err.status = 400;
      throw err;
    }
    patch.githubToken = gh;
  }
  if (typeof openaiApiKey === "string" && openaiApiKey.trim()) {
    const oa = acceptedOpenAIKey(openaiApiKey);
    if (!oa) {
      const err = new Error("That OpenAI key doesn't look valid.");
      err.status = 400;
      throw err;
    }
    patch.openaiApiKey = oa;
  }
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
