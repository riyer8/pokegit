import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompareSuggestionPool,
  filterCompareSuggestions,
  COMPARE_SUGGEST_LIMIT,
} from "../src/lib/compare-suggest.js";

describe("compare suggestions", () => {
  const pool = buildCompareSuggestionPool({
    viewerLogin: "ramya",
    following: [
      { login: "octocat", name: "The Octocat" },
      { login: "gaearon" },
      { login: "yyx990803" },
      { login: "sindresorhus" },
      { login: "tj" },
      { login: "addyosmani" },
      { login: "ramya" },
    ],
  });

  it("puts the logged-in viewer first and de-dupes them from following", () => {
    assert.equal(pool[0].kind, "you");
    assert.equal(pool[0].login, "ramya");
    assert.equal(pool.filter((u) => u.login.toLowerCase() === "ramya").length, 1);
  });

  it("caps the visible list at 5", () => {
    const visible = filterCompareSuggestions(pool, { excludeLogin: "someone-else" });
    assert.equal(visible.length, COMPARE_SUGGEST_LIMIT);
    assert.equal(visible[0].login, "ramya");
  });

  it("omits the profile currently being viewed", () => {
    const visible = filterCompareSuggestions(pool, { excludeLogin: "Ramya" });
    assert.equal(visible.length, 5);
    assert.ok(!visible.some((u) => u.login.toLowerCase() === "ramya"));
    assert.equal(visible[0].login, "octocat");
  });

  it("narrows as the person types, still max 5", () => {
    const visible = filterCompareSuggestions(pool, { query: "o", excludeLogin: "ramya" });
    assert.ok(visible.length <= 5);
    assert.ok(visible.every((u) => u.login.toLowerCase().includes("o") || String(u.name || "").toLowerCase().includes("o")));
    assert.equal(visible[0].login, "octocat");
  });

  it("matches display names and prefers prefix hits", () => {
    const visible = filterCompareSuggestions(pool, { query: "octo" });
    assert.equal(visible[0].login, "octocat");
    const byName = filterCompareSuggestions(pool, { query: "the octo" });
    assert.equal(byName[0].login, "octocat");
  });
});
