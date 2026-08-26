#!/usr/bin/env node
/**
 * Fail if tracked files look like they contain live secrets.
 * Run: node scripts/check-no-secrets.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const DANGEROUS = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
];

const mustIgnore = [".env"];
for (const f of mustIgnore) {
  if (!existsSync(f)) continue;
  try {
    const out = execSync(`git check-ignore -v ${f}`, { encoding: "utf8" });
    if (!out.trim()) throw new Error("not ignored");
  } catch {
    try {
      execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
      console.error(`FAIL: ${f} exists but is not gitignored`);
      process.exit(1);
    } catch {
      /* not a git repo */
    }
  }
}

let files = [];
try {
  files = execSync("git ls-files", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  console.log("No git repo yet; skip tracked-file scan.");
  process.exit(0);
}

let bad = false;
for (const file of files) {
  if (file.endsWith(".ttf") || file.endsWith(".png")) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const re of DANGEROUS) {
    if (re.test(text)) {
      console.error(`FAIL: possible secret in tracked file: ${file}`);
      bad = true;
      break;
    }
  }
}

if (bad) process.exit(1);
console.log("OK: no obvious secrets in tracked files.");
