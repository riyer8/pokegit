import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizePublicActivity, activityAdjective, pushEventWeight, buildWeeklyPublicActivity, buildActivityCharts } from "../src/lib/activity.js";
import { buildGlance, buildObservations } from "../src/lib/insights.js";
import { heuristicSummary } from "../src/lib/summarize.js";
import { aggregateProfileFocus } from "../src/lib/focus.js";

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
    focusScores: opts.focusScores || { systems: 5, frontend: 4 },
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

  it("counts stripped PushEvent payloads as pushes", () => {
    const events = [
      {
        type: "PushEvent",
        created_at: new Date().toISOString(),
        repo: { name: "alice/widget" },
        payload: { before: "abc123", head: "def456", ref: "refs/heads/main" },
      },
      {
        type: "PushEvent",
        created_at: new Date().toISOString(),
        repo: { name: "alice/api" },
        payload: {},
      },
    ];
    assert.equal(pushEventWeight(events[0]), 1);
    assert.equal(pushEventWeight(events[1]), 1);
    const activity = summarizePublicActivity(events, { analyzedRepos: [] });
    assert.equal(activity.pushCount, 2);
    const weeks = buildWeeklyPublicActivity(events, [], 12);
    const total = weeks.reduce((s, w) => s + w.pushes, 0);
    assert.equal(total, 2);
  });

  it("builds honest tabbed chart views", () => {
    const now = Date.now();
    const msWeek = 7 * 24 * 60 * 60 * 1000;
    const weekStart = now - 11 * msWeek;
    const charts = buildActivityCharts({
      impression: {
        weeklyGraph: [{ weekStart, levelSum: 12 }],
        weeklyPublic: [{ weekStart, pushes: 3 }],
        weeklyRepoUpdates: [{ weekStart, repoUpdates: 2 }],
        yearCount: 500,
        includesPrivate: false,
      },
      pulse: { yearCount: 500, includesPrivate: false, weeks: [{ weekStart, levelSum: 12 }] },
      weekly: [{ weekStart, pushes: 3, repoUpdates: 2 }],
      activity: { pushCount: 3 },
      allRepos: [{ name: "a" }, { name: "b" }],
    });
    assert.equal(charts.defaultId, "contributions");
    assert.equal(charts.views.length, 3);
    const contrib = charts.views.find((v) => v.id === "contributions");
    assert.match(contrib.caption, /not commit/i);
    assert.equal(contrib.bars[0].value, 12);
    const pushes = charts.views.find((v) => v.id === "pushes");
    assert.match(pushes.caption, /push events/i);
  });

  it("avoids generic engineer / limited-testing stock phrases", () => {
    const analyzed = [
      item("alpha", { tests: false, language: "Go", daysAgo: 5, focusScores: { systems: 7, infra: 5 } }),
      item("beta", { tests: false, language: "Go", daysAgo: 20, focusScores: { systems: 6.5, infra: 4 } }),
      item("gamma", { tests: false, language: "Python", daysAgo: 40, focusScores: { ai: 5, systems: 4 } }),
    ];
    const profileFocus = aggregateProfileFocus(analyzed);
    const activity = summarizePublicActivity(
      [
        {
          type: "PushEvent",
          created_at: new Date().toISOString(),
          repo: { name: "u/alpha" },
          payload: { size: 8 },
        },
      ],
      { analyzedRepos: analyzed, profileActivityScore: 7.5 }
    );
    const observations = buildObservations(analyzed, profileFocus, [{ name: "Go", percent: 70 }], activity);
    const glance = buildGlance(
      { login: "ramya", name: "Ramya" },
      profileFocus,
      observations,
      null,
      [{ name: "Go", percent: 70 }],
      activity
    );
    const summary = heuristicSummary({
      user: { login: "ramya", name: "Ramya" },
      profileFocus,
      analyzedRepos: analyzed,
      observations,
      activity,
      aiAssistanceHeuristic: { level: "none", confidence: "medium" },
    });

    assert.notEqual(glance.headline, "Public GitHub engineer");
    assert.ok(!/Public GitHub engineer/i.test(glance.headline));
    assert.ok(!/Limited testing infrastructure is visible/i.test(JSON.stringify(observations)));
    assert.ok(!/Limited testing infrastructure is visible/i.test(summary.concerns.map((c) => c.text).join(" ")));
    assert.match(glance.headline, /Go|Systems|Ramya|commit|builder|engineer/i);
    assert.ok(observations.some((o) => /alpha|Go|Systems|commit/i.test(o.title)));
  });
});
