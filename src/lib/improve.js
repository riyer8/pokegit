/**
 * Actionable public-profile improvements for the logged-in user's own profile.
 * Never invents private-repo advice. Soft, practical, evidence-backed.
 */

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

  const starters = buildStarters({ login, lang, langs, scores, repos, noTests, starred });

  // Sort: high first
  const rank = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));

  return {
    actions: actions.slice(0, 5),
    starters: starters.slice(0, 4),
    forUser: login,
  };
}

function buildStarters({ login, lang, langs, scores, repos, noTests, starred }) {
  const stack = lang || langs[0]?.name || "your main language";
  const second = langs[1]?.name;
  const flagship = starred?.repo?.name || `${login}-lab`;
  const testTarget = noTests[0]?.repo?.name;

  const starters = [];

  starters.push({
    id: "starter-tests",
    emoji: "🧪",
    title: `test-kit-${(stack || "app").toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    pitch: `A tiny ${stack} playground whose only job is great tests + CI. Use it as a template you copy into real repos.`,
    leapFrom: testTarget
      ? `Extract a pure function from ${testTarget} and cover it first.`
      : `Start from a single module you already wrote.`,
    stack: [stack, "CI", "tests"].filter(Boolean),
  });

  starters.push({
    id: "starter-readme",
    emoji: "📚",
    title: "showcase-readme",
    pitch: "One polished public repo that teaches a small idea well: crisp README, topics, license, and a 60-second quickstart.",
    leapFrom: `Fork the structure of ${flagship}'s best parts into a cleaner "hello world" of your craft.`,
    stack: [stack, "docs"].filter(Boolean),
  });

  if ((scores.activity || 0) < 7 || repos.some((a) => daysSince(a.repo.pushedAt) > 120)) {
    starters.push({
      id: "starter-revive",
      emoji: "🔄",
      title: "revival-log",
      pitch: "A short public changelog project: each week you revive or tidy one older repo and note what changed.",
      leapFrom: "Turn maintenance into a visible habit instead of silent guilt.",
      stack: ["docs", "maintenance"],
    });
  }

  if (second && second !== stack) {
    starters.push({
      id: "starter-bridge",
      emoji: "🌉",
      title: `${stack.toLowerCase()}-${second.toLowerCase()}-bridge`,
      pitch: `A small tool that connects ${stack} and ${second}. Cross-stack utilities read as depth, not noise.`,
      leapFrom: `Reuse patterns you already use in both ecosystems.`,
      stack: [stack, second],
    });
  } else {
    starters.push({
      id: "starter-cli",
      emoji: "⚡",
      title: "weekend-cli",
      pitch: `A focused ${stack} CLI that does one useful thing. Small surface area, high polish, easy to demo.`,
      leapFrom: "Automate something you already do by hand.",
      stack: [stack, "cli"],
    });
  }

  starters.push({
    id: "starter-profile-readme",
    emoji: "✨",
    title: `${login}/${login}`,
    pitch: "A profile README that points visitors to your best 3 repos and what you're exploring next.",
    leapFrom: "Treat your profile as a landing page, not a file dump.",
    stack: ["markdown", "profile"],
  });

  return starters;
}
