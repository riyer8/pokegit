import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizePublicActivity, activityAdjective } from "../src/lib/activity.js";
import { buildGlance, buildObservations } from "../src/lib/insights.js";
import { heuristicSummary } from "../src/lib/summarize.js";

function repo(name, opts = {}) {
  const now = Date.now();
  const daysAgo = opts.daysAgo ?? 10;
  return {
    name,
    language: opts.language || "TypeScript",
    stargazers: opts.stars ?? 5,
    forks: 0,
    size: 120,
    topics: [],
    archived: false,
    createdAt: new Date(now - 864e5 * 800).toISOString(),
    pushedAt: new Date(now - 864e5 * daysAgo).toISOString(),
  };
}

function item(name, opts = {}) {
  const r = repo(name, opts);
  return {
    repo: r,
    signals: {
      hasTests: Boolean(opts.tests),
      hasCi: Boolean(opts.ci),
      hasReadme: true,
      hasDocs: false,
      recentCommitApprox: opts.commits,
      commitSampleCount: opts.commits ?? null,
    },
    scores: {
      architecture: opts.arch ?? 6,
      testing: opts.testing ?? (opts.tests ? 8 : 3),
      maintenance: opts.maint ?? 7,
      documentation: opts.docs ?? 5,
      complexity: opts.complexity ?? 5,
      activity: opts.activity ?? 7,
    },
    pokemon: { name: opts.poke || "Eevee", personality: "Still evolving", why: "mixed" },
  };
}

describe("activity + personalized copy", () => {
  it("summarizes push-event commit volume", () => {
    const events = [
      {
        type: "PushEvent",
        created_at: new Date().toISOString(),
        repo: { name: "alice/widget" },
        payload: { size: 4, commits: [{}, {}, {}, {}] },
      },
      {
        type: "PushEvent",
        created_at: new Date().toISOString(),
        repo: { name: "alice/widget" },
        payload: { size: 2 },
      },
      {
        type: "PushEvent",
        created_at: new Date().toISOString(),
        repo: { name: "alice/api" },
        payload: { size: 10 },
      },
      { type: "WatchEvent", repo: { name: "alice/widget" }, payload: {} },
    ];
    const activity = summarizePublicActivity(events, {
      analyzedRepos: [item("widget"), item("api")],
      profileActivityScore: 8,
    });
    assert.equal(activity.commitApprox, 16);
    assert.equal(activity.reposTouched.length, 2);
    assert.ok(["hot", "active"].includes(activity.label));
    assert.equal(activityAdjective(activity).length > 0, true);
  });

  it("avoids generic engineer / limited-testing stock phrases", () => {
    const analyzed = [
      item("alpha", { tests: false, language: "Go", daysAgo: 5 }),
      item("beta", { tests: false, language: "Go", daysAgo: 20 }),
      item("gamma", { tests: false, language: "Python", daysAgo: 40 }),
    ];
    const scores = {
      architecture: 6,
      testing: 3,
      maintenance: 6,
      documentation: 5,
      complexity: 5,
      activity: 7.5,
    };
    const activity = summarizePublicActivity(
      [
        {
          type: "PushEvent",
          created_at: new Date().toISOString(),
          repo: { name: "u/alpha" },
          payload: { size: 8 },
        },
      ],
      { analyzedRepos: analyzed, profileActivityScore: scores.activity }
    );
    const observations = buildObservations(analyzed, scores, [{ name: "Go", percent: 70 }], activity);
    const glance = buildGlance(
      { login: "ramya", name: "Ramya" },
      scores,
      observations,
      null,
      [{ name: "Go", percent: 70 }],
      activity
    );
    const summary = heuristicSummary({
      user: { login: "ramya", name: "Ramya" },
      profileScores: scores,
      analyzedRepos: analyzed,
      observations,
      activity,
      aiAssistanceHeuristic: { level: "none", confidence: "medium" },
    });

    assert.notEqual(glance.headline, "Public GitHub engineer");
    assert.ok(!/Public GitHub engineer/i.test(glance.headline));
    assert.ok(!/Limited testing infrastructure is visible/i.test(JSON.stringify(observations)));
    assert.ok(!/Limited testing infrastructure is visible/i.test(summary.concerns.map((c) => c.text).join(" ")));
    assert.match(glance.headline, /Go|Active|Ramya|commit/i);
    assert.ok(observations.some((o) => /alpha|beta|test/i.test(o.title)));
  });
});
