import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreRepo, aggregateProfileScores, SCORE_DISCLAIMER } from "../src/lib/score.js";

function repo(overrides = {}) {
  return {
    name: "sample",
    language: "TypeScript",
    topics: ["cli"],
    description: "Useful sample project description",
    stargazers: 12,
    size: 400,
    pushedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 400 * 864e5).toISOString(),
    archived: false,
    license: "MIT",
    ...overrides,
  };
}

describe("scoreRepo", () => {
  it("scores higher when tests and CI exist", () => {
    const weak = scoreRepo(repo(), {
      hasTests: false,
      hasCi: false,
      hasReadme: true,
      hasDocs: false,
      rootFiles: ["package.json"],
    });
    const strong = scoreRepo(repo(), {
      hasTests: true,
      hasCi: true,
      hasReadme: true,
      hasDocs: true,
      hasContributing: true,
      hasLicenseFile: true,
      rootFiles: ["package.json", "src", "test"],
    });
    assert.ok(strong.testing > weak.testing);
    assert.ok(strong.documentation >= weak.documentation);
    assert.ok(strong.testing >= 8);
  });

  it("clamps scores to 0-10", () => {
    const s = scoreRepo(repo({ size: 50000, stargazers: 9000 }), {
      hasTests: true,
      hasCi: true,
      hasReadme: true,
      hasDocs: true,
      rootFiles: ["src", "lib", "pkg"],
    });
    for (const key of ["architecture", "testing", "maintenance", "documentation", "complexity", "activity"]) {
      assert.ok(s[key] >= 0 && s[key] <= 10, key);
    }
  });
});

describe("aggregateProfileScores", () => {
  it("returns nulls when empty", () => {
    const out = aggregateProfileScores([]);
    assert.equal(out.enoughData, false);
    assert.equal(out.testing, null);
  });

  it("averages weighted repo scores", () => {
    const a = {
      repo: repo({ stargazers: 50 }),
      scores: scoreRepo(repo({ stargazers: 50 }), { hasTests: true, hasCi: true, hasReadme: true, rootFiles: [] }),
    };
    const b = {
      repo: repo({ stargazers: 2, archived: true }),
      scores: scoreRepo(repo({ stargazers: 2, archived: true }), {
        hasTests: false,
        hasCi: false,
        hasReadme: false,
        rootFiles: [],
      }),
    };
    const out = aggregateProfileScores([a, b]);
    assert.equal(out.enoughData, true);
    assert.ok(out.testing != null);
  });
});

describe("SCORE_DISCLAIMER", () => {
  it("is present and avoids em dashes", () => {
    assert.ok(SCORE_DISCLAIMER.length > 20);
    assert.equal(SCORE_DISCLAIMER.includes("\u2014"), false);
  });
});
