import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSafeRepoRelPath,
  isIgnoredPath,
  collectTreePaths,
  pickExcerptPaths,
  formatChatContext,
} from "../src/lib/repo-chat.js";

describe("repo chat packing", () => {
  it("rejects traversal and secret-looking files", () => {
    assert.equal(isSafeRepoRelPath("src/index.ts"), true);
    assert.equal(isSafeRepoRelPath("../etc/passwd"), false);
    assert.equal(isIgnoredPath("src/index.ts"), false);
    assert.equal(isIgnoredPath(".env"), true);
    assert.equal(isIgnoredPath("config/secrets.yaml"), true);
    assert.equal(isIgnoredPath("node_modules/left-pad/index.js"), true);
  });

  it("keeps a public tree and skips junk", () => {
    const { paths, truncated } = collectTreePaths(
      [
        { type: "blob", path: "src/index.ts", size: 1200 },
        { type: "blob", path: "node_modules/x/index.js", size: 80 },
        { type: "blob", path: ".env", size: 40 },
        { type: "tree", path: "src" },
        { type: "blob", path: "package.json", size: 400 },
      ],
      { limit: 10 }
    );
    assert.deepEqual(paths, ["src/index.ts", "package.json"]);
    assert.equal(truncated, false);
  });

  it("prefers entry and manifest files for excerpts", () => {
    const picks = pickExcerptPaths([
      "README.md",
      "dist/app.min.js",
      "src/index.ts",
      "package.json",
      "tests/foo.test.ts",
    ]);
    assert.ok(picks.includes("package.json"));
    assert.ok(picks.includes("src/index.ts"));
    assert.equal(picks.includes("README.md"), false);
    assert.equal(picks.includes("dist/app.min.js"), false);
  });

  it("formats context with the tree and excerpts", () => {
    const text = formatChatContext({
      fullName: "octo/left-pad",
      description: "pad strings",
      aboutSummary: "A tiny string library",
      dnaLabel: "📦 Library",
      languages: [{ name: "JavaScript", percent: 100 }],
      fileCount: 2,
      truncated: false,
      paths: ["package.json", "index.js"],
      excerpts: [{ path: "index.js", text: "export default function pad() {}" }],
      readme: "A tiny library that left-pads strings.",
    });
    assert.match(text, /octo\/left-pad/);
    assert.match(text, /index\.js/);
    assert.match(text, /left-pads/);
    assert.equal(/[\u2013\u2014]/.test(text), false);
  });
});
