import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareProfiles, profileFlavor } from "../src/lib/compare.js";
import { parseContributionPulse } from "../src/lib/contributions.js";

function profile(login, overrides = {}) {
  const now = new Date().toISOString();
  return {
    user: { login, bio: overrides.bio || null, avatarUrl: "" },
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
    hasProfileReadme: Boolean(overrides.hasProfileReadme),
    activity: overrides.activity || {
      label: "active",
      commitApprox: 12,
      reposTouched: [{ name: "app", commits: 12 }],
      newestPushDays: 4,
      newestRepoName: "app",
    },
    contributionPulse: overrides.contributionPulse || null,
    surprises: overrides.surprises || [],
    analyzedRepos: overrides.repos || [
      {
        repo: {
          name: "a",
          language: "TypeScript",
          stargazers: 10,
          pushedAt: now,
          description: "a service",
          topics: ["api"],
        },
        signals: { hasTests: true, hasCi: true },
        pokemon: { name: "Blissey" },
        scores: { architecture: 8, testing: 9, maintenance: 8 },
      },
    ],
  };
}

describe("compareProfiles", () => {
  it("does not rank who is better", () => {
    const out = compareProfiles(profile("alice"), profile("bob"));
    assert.ok(out.disclaimer.toLowerCase().includes("not a ranking"));
    assert.equal(out.disclaimer.includes("\u2014"), false);
  });

  it("handles missing users safely", () => {
    const out = compareProfiles(null, null);
    assert.deepEqual(out.lenses, []);
    assert.deepEqual(out.differences, []);
  });

  it("focuses on uniqueness, activity, and whimsy", () => {
    const left = profile("alice", {
      bio: "✨ making weird little toys",
      langs: [
        { name: "Rust", percent: 60 },
        { name: "TypeScript", percent: 40 },
      ],
      hasProfileReadme: true,
      activity: {
        label: "hot",
        commitApprox: 42,
        reposTouched: [{ name: "doodle-box", commits: 20 }],
        newestPushDays: 1,
        newestRepoName: "doodle-box",
      },
      repos: [
        {
          repo: {
            name: "doodle-box",
            language: "Rust",
            stargazers: 4,
            pushedAt: new Date().toISOString(),
            description: "a playful generative toy 🎨",
            topics: ["fun", "art", "generative"],
          },
          signals: { hasTests: false, hasCi: false },
          pokemon: { name: "Ditto" },
          scores: { architecture: 5, testing: 3, maintenance: 5 },
        },
      ],
    });
    const right = profile("bob", {
      langs: [{ name: "Python", percent: 90 }],
      activity: {
        label: "quiet",
        commitApprox: 0,
        reposTouched: [],
        newestPushDays: 200,
        newestRepoName: "legacy",
      },
      contributionPulse: { yearCount: 220, includesPrivate: true, recentActiveDays: 8 },
      repos: [
        {
          repo: {
            name: "etl",
            language: "Python",
            stargazers: 40,
            pushedAt: "2022-01-01",
            description: "batch jobs",
            topics: ["data"],
          },
          signals: { hasTests: true, hasCi: true },
          pokemon: { name: "Golem" },
          scores: { architecture: 8, testing: 8, maintenance: 4 },
        },
      ],
    });
    const out = compareProfiles(left, right);
    const ids = out.lenses.map((l) => l.id);
    assert.deepEqual(ids, ["uniqueness", "activity", "whimsy"]);
    const uniq = out.lenses.find((l) => l.id === "uniqueness");
    const act = out.lenses.find((l) => l.id === "activity");
    const whim = out.lenses.find((l) => l.id === "whimsy");
    assert.match(uniq.body, /Rust/i);
    assert.match(act.body, /shipping in public/i);
    assert.match(act.body, /private/i);
    assert.match(whim.body, /playful|emoji|toy/i);
    assert.ok(!out.lenses.some((l) => /better engineer/i.test(l.body)));
    assert.ok(out.lenses.every((l) => !l.body.includes("\u2014")));
  });

  it("reads flavor from emoji, toys, and unusual langs", () => {
    const flav = profileFlavor(
      profile("kai", {
        bio: "🎮",
        langs: [{ name: "Zig", percent: 70 }],
        hasProfileReadme: true,
        repos: [
          {
            repo: {
              name: "playground",
              language: "Zig",
              stargazers: 1,
              pushedAt: new Date().toISOString(),
              description: "silly sketch",
              topics: ["toy"],
            },
            signals: {},
            pokemon: { name: "Ditto" },
            scores: {},
          },
        ],
      })
    );
    assert.ok(flav.uniqueness.unusualLangs.includes("Zig"));
    assert.ok(flav.whimsy.bioPlayful);
    assert.ok(flav.whimsy.playfulRepos.includes("playground"));
    assert.equal(flav.whimsy.ditto, 1);
  });
});

describe("parseContributionPulse", () => {
  it("reads year totals, private note, and recent active days", () => {
    const html = `
      <h2>128 contributions in the last year</h2>
      <span>Including private contributions</span>
      <td data-date="2099-01-01" data-level="0"></td>
      <td data-date="2099-01-02" data-level="3"></td>
      <td data-date="2099-01-03" data-level="1"></td>
    `;
    const now = Date.parse("2099-01-10T12:00:00Z");
    const pulse = parseContributionPulse(html, now);
    assert.equal(pulse.yearCount, 128);
    assert.equal(pulse.includesPrivate, true);
    assert.equal(pulse.recentActiveDays, 2);
    assert.equal(pulse.recentLevelSum, 4);
  });

  it("returns null on empty html", () => {
    assert.equal(parseContributionPulse(""), null);
  });
});
