#!/usr/bin/env node
/**
 * Reads .env → writes src/lib/secrets.local.js (gitignored).
 * Run after editing .env: node scripts/sync-secrets.mjs
 *
 * WARNING: secrets.local.js lives inside the extension folder for local testing.
 * Never commit it, never upload the unpacked folder to the Chrome Web Store,
 * and never zip-share the project with this file present.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const outPath = join(root, "src/lib/secrets.local.js");

if (!existsSync(envPath)) {
  console.error("Missing .env — copy .env.example to .env and fill keys.");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      if (i === -1) return null;
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
    .filter(Boolean)
);

const github = env.GITHUB_TOKEN || "";
const openai = env.OPENAI_API_KEY || "";

const js = `/**
 * AUTO-GENERATED from .env by scripts/sync-secrets.mjs — DO NOT COMMIT
 */
export const GITHUB_TOKEN = ${JSON.stringify(github)};
export const OPENAI_API_KEY = ${JSON.stringify(openai)};
`;

writeFileSync(outPath, js);
console.log("Wrote src/lib/secrets.local.js from .env");
