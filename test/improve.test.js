import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildImprovements, buildStarterPool, pickStarters } from "../src/lib/improve.js";
import { buildObservations, buildEvidence, buildSurprises } from "../src/lib/insights.js";
import { aggregateProfileFocus } from "../src/lib/focus.js";

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
    focusScores: { data: 6, ai: 4 },
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
    focusScores: { ai: 7, research: 5 },
  },
];

const profileFocus = aggregateProfileFocus(analyzedRepos);

describe("buildImprovements", () => {
  const basePayload = {
    user: { login: "demo", bio: "" },
    profileScores: scores,
    profileFocus,
    languageSummary: [{ name: "Python", percent: 80 }],
    analyzedRepos,
    activity: { pushCount: 3, commitApprox: 3 },
    hasProfileReadme: false,
  };

  it("returns presence coaching with positioning and focus-aligned starters", () => {
    const out = buildImprovements(basePayload);
    assert.ok(out.positioning?.outsiderRead);
    assert.ok(out.positioning?.taglines?.length >= 1);
    assert.ok(out.positioning?.present?.pins?.length >= 1);
    assert.ok(out.actions.length >= 2);
    assert.equal(out.starters.length, 5);
    assert.ok(out.actions.every((a) => a.steps?.length && a.title));
    assert.ok(out.starters.every((s) => s.title && s.pitch && s.leapFrom));
    assert.ok(out.starters.every((s) => Array.isArray(s.pillars) && s.pillars.length >= 1));
    assert.ok(out.starters.some((s) => s.pillars.some((p) => p.label && p.icon)));
    const pool = buildStarterPool(basePayload);
    assert.ok(pool.every((s) => s.pillars?.length >= 1));
    assert.ok(!out.actions.some((a) => /test suite|GitHub Actions CI/i.test(a.title)));
    assert.ok(!out.starters.some((s) => /test-kit/i.test(s.title)));
    assert.equal(JSON.stringify(out).includes("\u2014"), false);
  });

  it("rotates a fresh batch of 5 on refresh", () => {
    const payload = {
      ...basePayload,
      languageSummary: [
        { name: "Python", percent: 80 },
        { name: "TypeScript", percent: 20 },
      ],
    };
    const first = buildImprovements(payload).starters.map((s) => s.title);
    const pool = buildStarterPool(payload);
    const next = pickStarters(pool, { count: 5, seed: 3, excludeTitles: first });
    assert.equal(next.length, 5);
    assert.ok(pool.length >= 5);
    const overlap = next.filter((s) => first.includes(s.title));
    assert.ok(overlap.length < 5);
  });
});

describe("insights builders", () => {
  it("builds evidence and observations without em dashes", () => {
    const obs = buildObservations(analyzedRepos, profileFocus, [{ name: "Python", percent: 80 }]);
    const ev = buildEvidence(analyzedRepos, profileFocus);
    const sur = buildSurprises(analyzedRepos, profileFocus, [{ name: "Python", percent: 80 }]);
    assert.ok(Array.isArray(obs));
    assert.ok(ev.length >= 1);
    assert.ok(Array.isArray(sur));
    assert.equal(JSON.stringify({ obs, ev, sur }).includes("\u2014"), false);
  });
});
