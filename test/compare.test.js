import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareProfiles } from "../src/lib/compare.js";

function profile(login, overrides = {}) {
  return {
    user: { login },
    profileScores: {
      testing: 8,
      maintenance: 7,
      architecture: 7,
      documentation: 6,
      activity: 7,
      ...overrides.scores,
    },
    languageSummary: overrides.langs || [{ name: "TypeScript", percent: 80 }],
    glance: { headline: `${login} engineer` },
    analyzedRepos: overrides.repos || [
      {
        repo: { name: "a", language: "TypeScript", stargazers: 10, pushedAt: new Date().toISOString() },
        signals: { hasTests: true, hasCi: true },
        pokemon: { name: "Blissey" },
        scores: { architecture: 8, testing: 9, maintenance: 8 },
      },
    ],
  };
}

describe("compareProfiles", () => {
  it("does not rank who is better", () => {
    const left = profile("alice", { scores: { testing: 9, activity: 9 } });
    const right = profile("bob", {
      scores: { testing: 3, activity: 3, architecture: 8 },
      langs: [{ name: "Python", percent: 90 }],
      repos: [
        {
          repo: { name: "b", language: "Python", stargazers: 40, pushedAt: "2022-01-01" },
          signals: { hasTests: false, hasCi: false },
          pokemon: { name: "Dragonite" },
          scores: { architecture: 8, testing: 3, maintenance: 4 },
        },
      ],
    });
    const out = compareProfiles(left, right);
    assert.ok(out.disclaimer.toLowerCase().includes("not a ranking"));
    assert.ok(out.differences.length >= 1);
    assert.equal(out.disclaimer.includes("\u2014"), false);
  });

  it("handles missing users safely", () => {
    const out = compareProfiles(null, null);
    assert.deepEqual(out.differences, []);
  });
});
