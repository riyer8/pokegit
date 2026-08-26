/**
 * Actionable public-profile improvements for the logged-in user's own profile.
 * Never invents private-repo advice. Soft, practical, evidence-backed.
 */

import { openaiChatJson } from "./openai-request.js";

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function primaryLang(languageSummary = []) {
  return languageSummary[0]?.name || null;
}

/**
 * @returns {{ actions: Array, starters: Array }}
 */
export function buildImprovements(payload) {
  const repos = payload?.analyzedRepos || [];
  const scores = payload?.profileScores || {};
  const langs = payload?.languageSummary || [];
  const lang = primaryLang(langs);
  const n = repos.length || 1;
  const login = payload?.user?.login || "you";

  const noTests = repos.filter((a) => !a.signals?.hasTests);
  const noCi = repos.filter((a) => !a.signals?.hasCi);
  const noReadme = repos.filter((a) => !a.signals?.hasReadme);
  const quiet = repos.filter((a) => daysSince(a.repo.pushedAt) > 180);
  const noDesc = repos.filter((a) => !a.repo.description || a.repo.description.length < 12);
  const starred = [...repos].sort((a, b) => (b.repo.stargazers || 0) - (a.repo.stargazers || 0))[0];

  const actions = [];

  if (noTests.length >= 1) {
    const target = noTests[0].repo.name;
    actions.push({
      id: "add-tests",
      priority: "high",
      title: "Add a real test suite to one showcase repo",
      why: `${noTests.length}/${n} analyzed repos show no obvious tests. One well-tested public repo changes how your profile reads.`,
      steps: [
        `Pick ${target} (or your most starred project).`,
        lang === "TypeScript" || lang === "JavaScript"
          ? "Add Vitest or Jest with 3-5 meaningful tests for core logic."
          : lang === "Python"
            ? "Add pytest with a few tests for the main module."
            : "Add the idiomatic test runner for your stack.",
        "Mention the test command in the README.",
      ],
      evidence: noTests.slice(0, 3).map((a) => `No test signals in ${a.repo.name}`),
    });
  }

  if (noCi.length >= 1) {
    actions.push({
      id: "add-ci",
      priority: noTests.length ? "high" : "medium",
      title: "Wire GitHub Actions CI on your flagship repo",
      why: `${noCi.length}/${n} repos lack an obvious CI footprint. Public CI is a strong trust signal.`,
      steps: [
        "Add `.github/workflows/ci.yml` that runs install + test (and lint if you have it).",
        "Keep the workflow green on the default branch.",
        "Link the badge in the README if you like the polish.",
      ],
      evidence: noCi.slice(0, 3).map((a) => `No CI signals in ${a.repo.name}`),
    });
  }

  if (noReadme.length >= 1 || (scores.documentation || 0) < 7) {
    actions.push({
      id: "readme-pass",
      priority: "high",
      title: "Do a README pass on 1-2 public repos",
      why: "Outsiders decide in seconds. A clear README with problem, setup, and demo beats a vague description.",
      steps: [
        noReadme[0]
          ? `Start with ${noReadme[0].repo.name} (weak or missing README signal).`
          : `Refresh the README on ${starred?.repo?.name || "your top repo"}.`,
        "Lead with what it does, who it's for, and how to run it in under a minute.",
        "Add a short GIF/screenshot if it's UI-facing.",
      ],
      evidence: [
        noReadme.length ? `README thin in ${noReadme.length}/${n}` : null,
        `Docs score ${scores.documentation ?? "-"}/10`,
      ].filter(Boolean),
    });
  }

  if (noDesc.length >= 1) {
    actions.push({
      id: "repo-descriptions",
      priority: "medium",
      title: "Write one-line descriptions on bare repos",
      why: `${noDesc.length} analyzed repos lack a useful description. The profile grid looks unfinished without them.`,
      steps: [
        "GitHub → repo → gear next to About → Description.",
        "One concrete sentence. No buzzword salad.",
        "Add 2-4 topics (language, domain, framework).",
      ],
      evidence: noDesc.slice(0, 3).map((a) => a.repo.name),
    });
  }

  if (quiet.length >= 2 || (scores.activity || 0) <= 5.5) {
    actions.push({
      id: "revive-or-archive",
      priority: "medium",
      title: "Revive one quiet repo or archive finished ones",
      why: "A profile full of untouched projects reads stale. Touch what still matters; archive what doesn't.",
      steps: [
        quiet[0]
          ? `Decide on ${quiet[0].repo.name}: small update, clear README "status", or archive.`
          : "Pick the quietest public repo you still care about.",
        "A tiny useful commit (docs, dependency bump, bugfix) beats silence.",
        "Archive truly abandoned repos so visitors see intent.",
      ],
      evidence: quiet.slice(0, 3).map((a) => `${a.repo.name} (~${Math.round(daysSince(a.repo.pushedAt))}d quiet)`),
    });
  }

  if ((scores.testing || 0) >= 7 && (scores.documentation || 0) < 7) {
    actions.push({
      id: "docs-match-tests",
      priority: "medium",
      title: "Match your docs quality to your testing habits",
      why: "Your testing signals are stronger than docs. Closing that gap makes the whole silhouette look intentional.",
      steps: [
        "Add CONTRIBUTING.md or a short \"Development\" section.",
        "Document how to run tests and what \"done\" looks like.",
      ],
      evidence: [`Testing ${scores.testing}/10`, `Docs ${scores.documentation}/10`],
    });
  }

  if (!payload?.user?.bio || payload.user.bio.length < 20) {
    actions.push({
      id: "profile-bio",
      priority: "medium",
      title: "Tighten your GitHub profile bio + pin 3 repos",
      why: "The header is the first frame people see. Pins + a concrete bio set context before anyone opens a repo.",
      steps: [
        "Bio: what you build + one stack cue (keep it human).",
        "Pin your best 3 public repos (tests/docs/stars help).",
        "Optional: a profile README (`username/username`) with a short tour.",
      ],
      evidence: [payload?.user?.bio ? "Bio is short" : "No bio set"],
    });
  }

  // Always give at least a couple actions
  if (actions.length < 2) {
    actions.push({
      id: "polish-flagship",
      priority: "medium",
      title: "Polish one flagship repo end-to-end",
      why: "Even strong profiles benefit from one repo that looks \"finished\" in public.",
      steps: [
        `Choose ${starred?.repo?.name || "your favorite owned repo"}.`,
        "README, license, topics, tests, CI, and a clear status line.",
        "Cut or archive anything that distracts from that story.",
      ],
      evidence: [`Sample of ${n} repos`],
    });
  }

  // Sort: high first
  const rank = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));

  return {
    actions: actions.slice(0, 5),
    starters: pickStarters(buildStarterPool(payload), { count: 5, seed: 0 }),
    forUser: login,
  };
}

function slug(value, fallback = "app") {
  const s = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18);
  return s || fallback;
}

function starterContext(payload) {
  const repos = payload?.analyzedRepos || [];
  const langs = payload?.languageSummary || [];
  const scores = payload?.profileScores || {};
  const login = payload?.user?.login || "you";
  const lang = primaryLang(langs) || "your main language";
  const second = langs[1]?.name && langs[1].name !== lang ? langs[1].name : null;
  const starred = [...repos].sort((a, b) => (b.repo.stargazers || 0) - (a.repo.stargazers || 0))[0];
  const noTests = repos.filter((a) => !a.signals?.hasTests);
  const quiet = repos.filter((a) => daysSince(a.repo.pushedAt) > 120);
  const poke = repos.map((a) => a.pokemon?.name).filter(Boolean);
  const topics = [...new Set(repos.flatMap((a) => a.repo?.topics || []))];
  const names = repos.map((a) => a.repo?.name).filter(Boolean);
  const frontend =
    poke.includes("Sylveon") ||
    langs.some((l) => /TypeScript|JavaScript|HTML|CSS|Swift|Kotlin/.test(l.name || ""));
  return {
    login,
    lang,
    second,
    scores,
    repos,
    flagship: starred?.repo?.name || `${login}-lab`,
    testTarget: noTests[0]?.repo?.name || names[0] || null,
    quietRepo: quiet[0]?.repo?.name || null,
    poke,
    topics,
    names,
    frontend,
  };
}

export function buildStarterPool(payload) {
  const c = starterContext(payload);
  const pool = [
    {
      id: "starter-tests",
      emoji: "🧪",
      title: `test-kit-${slug(c.lang)}`,
      pitch: `A tiny ${c.lang} playground whose only job is great tests + CI. Copy it into real repos later.`,
      leapFrom: c.testTarget
        ? `Extract a pure function from ${c.testTarget} and cover it first.`
        : "Start from a single module you already wrote.",
      stack: [c.lang, "CI", "tests"].filter(Boolean),
    },
    {
      id: "starter-readme",
      emoji: "📚",
      title: "showcase-readme",
      pitch: "One polished public repo that teaches a small idea well: crisp README, topics, license, and a 60-second quickstart.",
      leapFrom: `Lift the best parts of ${c.flagship} into a cleaner hello-world of your craft.`,
      stack: [c.lang, "docs"].filter(Boolean),
    },
    {
      id: "starter-cli",
      emoji: "⚡",
      title: "weekend-cli",
      pitch: `A focused ${c.lang} CLI that does one useful thing. Small surface, high polish, easy to demo.`,
      leapFrom: "Automate something you already do by hand in this stack.",
      stack: [c.lang, "cli"],
    },
    {
      id: "starter-profile-readme",
      emoji: "✨",
      title: `${c.login}/${c.login}`,
      pitch: "A profile README that points visitors to your best 3 repos and what you want to explore next.",
      leapFrom: "Treat your profile as a landing page, not a file dump.",
      stack: ["markdown", "profile"],
    },
    {
      id: "starter-playground",
      emoji: "🎮",
      title: `${slug(c.lang)}-playground`,
      pitch: `A public sandbox for weird little ${c.lang} experiments. One mechanic, lots of personality, shipped in a weekend.`,
      leapFrom: c.names[0]
        ? `Steal a tiny idea from ${c.names[0]} and make it playful on purpose.`
        : "Give yourself a repo where unfinished is the point.",
      stack: [c.lang, "experimental"],
    },
    {
      id: "starter-action",
      emoji: "⚙️",
      title: "tiny-github-action",
      pitch: "A reusable GitHub Action that encodes one habit you already have (lint, test, changelog, topic check).",
      leapFrom: "Turn a local ritual into something other people can pin on their repos.",
      stack: ["GitHub Actions", c.lang],
    },
    {
      id: "starter-api",
      emoji: "📡",
      title: `mini-${slug(c.lang)}-api`,
      pitch: `A tiny ${c.lang} HTTP service with one endpoint, tests, and a README that a stranger can run.`,
      leapFrom: c.flagship
        ? `Carve a single useful slice out of ${c.flagship} and give it a door.`
        : "Expose one function you already trust.",
      stack: [c.lang, "api"],
    },
    {
      id: "starter-dataset",
      emoji: "🗂️",
      title: "public-notebook",
      pitch: "A small, documented dataset or notebook that makes one of your public interests inspectable.",
      leapFrom: c.topics[0]
        ? `Start from your "${c.topics[0]}" topic and publish a tiny slice of it.`
        : "Publish something you already poke at privately.",
      stack: [c.lang, "docs"],
    },
    {
      id: "starter-bot",
      emoji: "🤖",
      title: "weekend-bot",
      pitch: "A bot or cron job that does one charming, useful thing on a schedule. Public code, obvious personality.",
      leapFrom: "Automate a nag you already have, then give it a name.",
      stack: [c.lang, "automation"],
    },
  ];

  if (c.quietRepo || (c.scores.activity || 0) < 7) {
    pool.push({
      id: "starter-revive",
      emoji: "🔄",
      title: "revival-log",
      pitch: "A short public changelog: each week you revive or tidy one older repo and note what changed.",
      leapFrom: c.quietRepo
        ? `Start with ${c.quietRepo}. A tiny useful commit beats silence.`
        : "Turn maintenance into a visible habit.",
      stack: ["docs", "maintenance"],
    });
  }

  if (c.second) {
    pool.push({
      id: "starter-bridge",
      emoji: "🌉",
      title: `${slug(c.lang)}-${slug(c.second)}-bridge`,
      pitch: `A small tool that connects ${c.lang} and ${c.second}. Cross-stack utilities read as depth, not noise.`,
      leapFrom: `Reuse patterns you already use in both ecosystems.`,
      stack: [c.lang, c.second],
    });
  }

  if (c.frontend) {
    pool.push({
      id: "starter-ui",
      emoji: "🧚",
      title: "one-screen-ui",
      pitch: "A single-screen interface that makes one of your tools delightful. Design is the point.",
      leapFrom: `Wrap a slice of ${c.flagship} in something a stranger enjoys clicking.`,
      stack: [c.lang, "ui"],
    });
  }

  if (c.poke.includes("Ditto") || c.poke.includes("Eevee")) {
    pool.push({
      id: "starter-shape",
      emoji: "🌀",
      title: "shapeshift-lab",
      pitch: "A repo that is allowed to change form: three tiny experiments, one README that explains the thread.",
      leapFrom: "Lean into the experimental energy already on the profile, with a public finish line.",
      stack: [c.lang, "experimental"],
    });
  }

  return pool;
}

export function pickStarters(pool, { count = 5, seed = 0, excludeTitles = [] } = {}) {
  const list = Array.isArray(pool) ? [...pool] : [];
  if (!list.length) return [];
  const blocked = new Set((excludeTitles || []).map((t) => String(t).toLowerCase()));
  const fresh = list.filter((s) => s?.title && !blocked.has(String(s.title).toLowerCase()));
  const source = fresh.length >= count ? fresh : list;
  const start = Math.abs(Number(seed) || 0) % source.length;
  const rotated = [...source.slice(start), ...source.slice(0, start)];
  const out = [];
  const seen = new Set();
  for (const item of rotated) {
    const key = String(item.title || item.id || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= count) break;
  }
  return out;
}

function cleanStarterText(value) {
  return String(value || "")
    .replace(/\u2014/g, ".")
    .replace(/\u2013/g, ",")
    .replace(/\s*—\s*/g, ". ")
    .trim();
}

function normalizeStarter(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const title = slug(raw.title, `starter-${index + 1}`);
  const pitch = cleanStarterText(raw.pitch || raw.body || "");
  const leapFrom = cleanStarterText(raw.leapFrom || raw.leap || "");
  if (!pitch || !leapFrom) return null;
  const stack = Array.isArray(raw.stack)
    ? raw.stack.map((s) => cleanStarterText(s)).filter(Boolean).slice(0, 4)
    : [];
  return {
    id: String(raw.id || title),
    emoji: String(raw.emoji || "✦").slice(0, 4),
    title: String(raw.title || title).replace(/\u2014/g, "-").slice(0, 48),
    pitch,
    leapFrom,
    stack,
  };
}

function profileSketch(payload) {
  const c = starterContext(payload);
  const repoBits = (payload?.analyzedRepos || [])
    .slice(0, 8)
    .map((a) => {
      const topics = (a.repo?.topics || []).slice(0, 3).join(", ");
      return `- ${a.repo?.name} (${a.repo?.language || "?"}, ${a.pokemon?.name || "Eevee"})${
        a.repo?.description ? `: ${String(a.repo.description).slice(0, 90)}` : ""
      }${topics ? ` [${topics}]` : ""}`;
    })
    .join("\n");
  return [
    `User: @${c.login}`,
    `Stack: ${[c.lang, c.second].filter(Boolean).join(", ")}`,
    `Flagship: ${c.flagship}`,
    `Topics: ${c.topics.slice(0, 8).join(", ") || "(none)"}`,
    "Repos:",
    repoBits || "(thin public sample)",
  ].join("\n");
}

export function refreshStartersHeuristic(payload, { seed = 0, excludeTitles = [], steer = "" } = {}) {
  const starters = pickStarters(buildStarterPool(payload), { count: 5, seed, excludeTitles });
  const direction = cleanStarterText(steer).slice(0, 160);
  const note = direction
    ? `A fresh heuristic batch aimed at "${direction}", still leaping off your public stack. OpenAI can get more specific if a key is set.`
    : "A fresh batch leaping off your public repos.";
  return { starters, source: "heuristic", note };
}

export async function generateSteerStarters(payload, { steer = "", seed = 0, excludeTitles = [] } = {}) {
  const heuristic = refreshStartersHeuristic(payload, { seed, excludeTitles, steer });
  const direction = cleanStarterText(steer).slice(0, 280);

  const avoid = (excludeTitles || []).slice(0, 8).join(", ");
  const system = `You invent 5 small public GitHub starter repos for THIS person.
They must bounce off skills already visible (named repos, languages, topics).
Weekend-scale, specific, a little personality. Never generic "build a portfolio".
If they described a direction, steer toward it without abandoning their stack.
Leap from: name a real repo or public habit.
No em dashes. Product name is PokéGit.

Return ONLY JSON:
{
  "note": "one short sentence to the user about this batch",
  "starters": [
    { "emoji": "one emoji", "title": "kebab-case-repo-name", "pitch": "2 sentences", "leapFrom": "one sentence", "stack": ["lang", "theme"] }
  ]
}
Exactly 5 starters.`;

  try {
    const result = await openaiChatJson({
      system,
      temperature: 0.9,
      maxTokens: 900,
      user: [
        profileSketch(payload),
        direction
          ? `\nDirection they asked for:\n${direction}`
          : "\nNo extra direction. Surprise them with a fresh but grounded batch.",
        avoid ? `\nAvoid repeating these titles: ${avoid}` : "",
      ].join(""),
    });
    if (!result.ok) return heuristic;
    let parsed = null;
    const raw = result.content || "";
    try {
      parsed = JSON.parse(raw);
    } catch {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) {
        try {
          parsed = JSON.parse(fenced[1]);
        } catch {
          parsed = null;
        }
      }
    }
    const starters = (parsed?.starters || []).map(normalizeStarter).filter(Boolean).slice(0, 5);
    if (starters.length < 5) {
      const filler = pickStarters(buildStarterPool(payload), {
        count: 5 - starters.length,
        seed: seed + 3,
        excludeTitles: [...excludeTitles, ...starters.map((s) => s.title)],
      });
      starters.push(...filler);
    }
    return {
      starters: starters.slice(0, 5),
      source: "openai",
      note: cleanStarterText(parsed?.note || "") || "Five starters aimed at your public stack.",
    };
  } catch {
    return heuristic;
  }
}
