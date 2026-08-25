import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildImprovements } from "../src/lib/improve.js";
import { buildObservations, buildEvidence, buildSurprises } from "../src/lib/insights.js";

const scores = {
  architecture: 7,
  testing: 4,
  maintenance: 6,
  documentation: 5,
  complexity: 6,
  activity: 5,
};

const analyzedRepos = [
  {
    repo: {
      name: "trading_data",
      description: "",
      language: "Python",
      stargazers: 2,
      pushedAt: "2024-01-01T00:00:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
    },
    signals: { hasTests: false, hasCi: false, hasReadme: false },
    pokemon: { name: "Eevee" },
    scores,
  },
  {
    repo: {
      name: "app",
      description: "A real description here",
      language: "Python",
      stargazers: 8,
      pushedAt: new Date().toISOString(),
      createdAt: "2021-01-01T00:00:00.000Z",
    },
    signals: { hasTests: true, hasCi: false, hasReadme: true },
    pokemon: { name: "Pikachu" },
    scores: { ...scores, testing: 8 },
  },
];

describe("buildImprovements", () => {
  it("returns actionable steps and starter projects", () => {
    const out = buildImprovements({
      user: { login: "demo", bio: "" },
      profileScores: scores,
      languageSummary: [{ name: "Python", percent: 80 }],
      analyzedRepos,
    });
    assert.ok(out.actions.length >= 2);
    assert.ok(out.starters.length >= 2);
    assert.ok(out.actions.every((a) => a.steps?.length && a.title));
    assert.equal(JSON.stringify(out).includes("\u2014"), false);
  });
});

describe("insights builders", () => {
  it("builds evidence and observations without em dashes", () => {
    const obs = buildObservations(analyzedRepos, scores, [{ name: "Python", percent: 80 }]);
    const ev = buildEvidence(analyzedRepos, scores);
    const sur = buildSurprises(analyzedRepos, scores, [{ name: "Python", percent: 80 }]);
    assert.ok(Array.isArray(obs));
    assert.ok(ev.length >= 1);
    assert.ok(Array.isArray(sur));
    assert.equal(JSON.stringify({ obs, ev, sur }).includes("\u2014"), false);
  });
});
