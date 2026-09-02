/**
 * Public-presence coaching for your own profile.
 * Recruiter lens: how strangers read you, how to present yourself, what to fix first.
 */

import { openaiChatJson } from "./openai-request.js";
import { focusAreaLabel, focusAreaMeta, focusPillars } from "./focus.js";

const META_PILLARS = {
  presence: { key: "presence", label: "Public presence", icon: "📣" },
  portfolio: { key: "portfolio", label: "Portfolio", icon: "✨" },
};

function pillar(...keys) {
  const out = [];
  const seen = new Set();
  for (const key of keys) {
    const meta =
      key === "presence" || key === "portfolio"
        ? META_PILLARS[key]
        : focusAreaMeta(key);
    if (!meta || seen.has(meta.key)) continue;
    seen.add(meta.key);
    out.push(meta);
  }
  return out;
}

function topFocusKeys(focusScores, limit = 2) {
  return Object.entries(focusScores || {})
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score >= 4)
    .slice(0, limit)
    .map(([key]) => key);
}

function inferPillarsFromText(text = "") {
  const hay = String(text).toLowerCase();
  const hits = [];
  if (/llm|transformer|gpt|rag|prompt|langchain/.test(hay)) hits.push("llm");
  if (/machine-learning|\bml\b|model|inference|pytorch|tensorflow/.test(hay)) hits.push("ai");
  if (/infra|kubernetes|docker|terraform|deploy/.test(hay)) hits.push("infra");
  if (/research|notebook|benchmark|arxiv|thesis/.test(hay)) hits.push("research");
  if (/graphics|shader|webgl|render|visual/.test(hay)) hits.push("graphics");
  if (/frontend|react|vue|ui\b|component|tailwind/.test(hay)) hits.push("frontend");
  if (/systems|compiler|distributed|database|grpc|wasm/.test(hay)) hits.push("systems");
  if (/security|crypto|auth|vuln/.test(hay)) hits.push("security");
  if (/data|etl|pipeline|analytics|sql/.test(hay)) hits.push("data");
  if (/mobile|ios|android|flutter|react-native/.test(hay)) hits.push("mobile");
  if (/profile|readme|portfolio|bio|pin/.test(hay)) hits.push("presence");
  return focusPillars(hits);
}

function normalizePillars(raw, fallbackKeys = []) {
  const keys = Array.isArray(raw)
    ? raw.map((p) => (typeof p === "string" ? p : p?.key)).filter(Boolean)
    : [];
  const fromKeys = pillar(...(keys.length ? keys : fallbackKeys));
  return fromKeys.length ? fromKeys : pillar(...fallbackKeys);
}

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function primaryLang(languageSummary = []) {
  return languageSummary[0]?.name || null;
}

function topReposByImpressiveness(repos) {
  return [...repos].sort((a, b) => {
    const score = (item) => {
      const stars = item.repo.stargazers || 0;
      const days = daysSince(item.repo.pushedAt);
      const recency = Math.max(0, 1 - days / 400);
      const focusTop = Math.max(...Object.values(item.focusScores || {}), 0);
      return Math.log10(stars + 1) * 2.5 + recency * 3 + focusTop * 0.3;
    };
    return score(b) - score(a);
  });
}

function buildOutsiderRead(payload) {
  const repos = payload?.analyzedRepos || [];
  const focus = payload?.profileFocus?.top || [];
  const langs = payload?.languageSummary || [];
  const activity = payload?.activity || {};
  const user = payload?.user || {};
  const ranked = topReposByImpressiveness(repos);
  const flagship = ranked[0];
  const noDesc = repos.filter((a) => !a.repo.description || a.repo.description.length < 12);
  const quiet = repos.filter((a) => daysSince(a.repo.pushedAt) > 180);
  const parts = [];

  if (focus[0]) {
    parts.push(
      `A stranger probably slots you as ${focus[0].label.toLowerCase()}${focus[1] ? ` with ${focus[1].label.toLowerCase()} nearby` : ""}`
    );
  } else if (langs[0]) {
    parts.push(`Reads mostly as a ${langs[0].name} engineer from language weight`);
  }

  if (flagship) {
    const stars = flagship.repo.stargazers || 0;
    parts.push(
      stars >= 5
        ? `${flagship.repo.name} is the first repo worth opening (${stars}★)`
        : `${flagship.repo.name} is likely the flagship by recency and focus`
    );
  }

  if (!user.bio || user.bio.length < 20) {
    parts.push("no bio means GitHub pins and repo names do all the talking");
  }

  if (noDesc.length >= 2) {
    parts.push(`${noDesc.length} repos have no useful description, so the grid looks unfinished`);
  }

  if (quiet.length >= Math.ceil(repos.length / 2) && repos.length >= 3) {
    parts.push("many repos look dormant, which can read as scatter unless you curate");
  }

  if (activity.pushCount >= 8) {
    parts.push("recent public pushes show you are actively shipping");
  } else if (payload?.activityImpression?.possiblyPrivate) {
    parts.push("the contribution graph looks busier than public repos, so visitors may miss your current work");
  }

  if (!parts.length) {
    return "Public sample is thin. Visitors will need pins, a bio, and one clear flagship to understand you quickly.";
  }

  return `${parts.join(". ")}.`;
}

function buildTaglines(payload) {
  const focus = payload?.profileFocus?.top || [];
  const langs = payload?.languageSummary || [];
  const activity = payload?.activity || {};
  const glance = payload?.glance || {};
  const primary = focus[0];
  const secondary = focus[1];
  const lang = langs[0]?.name;
  const taglines = [];

  if (primary && lang) {
    taglines.push({
      text: `${primary.label} engineer · ${lang}`,
      why: "Leads with CS focus and home language. Works in a GitHub bio or LinkedIn headline.",
    });
  }

  if (primary && secondary) {
    taglines.push({
      text: `Building ${primary.label.toLowerCase()} tools · ${secondary.label.toLowerCase()} on the side`,
      why: "Shows a clear lane plus breadth without sounding like a keyword list.",
    });
  }

  if (activity?.pushCount >= 5 && primary) {
    taglines.push({
      text: `${primary.label} builder · shipping in public`,
      why: "Pairs your focus with visible momentum recruiters can verify.",
    });
  }

  const headline = glance.headline || payload?.summary?.glanceHeadline;
  if (headline && headline.length < 90 && !/mixed public signals/i.test(headline)) {
    taglines.push({
      text: headline.replace(/\.$/, "").slice(0, 100),
      why: "Pulled from what your repos already signal. Tweak words until it sounds like you.",
    });
  }

  if (lang && primary) {
    taglines.push({
      text: `${lang} · ${primary.label.toLowerCase()} · open source`,
      why: "Short stack cue when you want minimal bio real estate.",
    });
  }

  if (!taglines.length) {
    taglines.push({
      text: lang ? `${lang} builder · exploring in public` : "Builder · exploring in public",
      why: "Safe starting point while the public story sharpens.",
    });
  }

  const seen = new Set();
  return taglines
    .filter((t) => {
      const key = t.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function buildPresentYourself(payload) {
  const repos = payload?.analyzedRepos || [];
  const ranked = topReposByImpressiveness(repos);
  const pins = ranked.slice(0, 3).map((item) => ({
    repo: item.repo.name,
    reason: item.oneLiner || item.repo.description || `${item.repo.language || "Project"} work`,
    stars: item.repo.stargazers || 0,
    focus: Object.entries(item.focusScores || {})
      .sort((a, b) => b[1] - a[1])[0],
  }));

  const quiet = repos.filter((a) => daysSince(a.repo.pushedAt) > 270);
  const downplay = quiet.slice(0, 3).map((a) => a.repo.name);

  const focus = payload?.profileFocus?.top?.[0];
  const lead =
    focus && pins[0]
      ? `Lead with ${focus.label.toLowerCase()}: pin ${pins[0].repo} first, then ${pins
          .slice(1)
          .map((p) => p.repo)
          .join(" and ") || "your next best"}.`
      : pins.length
        ? `Pin ${pins.map((p) => p.repo).join(", ")} so visitors see your strongest public work first.`
        : "Pick 3 repos that tell one coherent story and pin them.";

  const voice =
    payload?.user?.bio && payload.user.bio.length >= 20
      ? "Your bio exists. Make sure it matches what pins and READMEs actually show."
      : "Write a bio before anyone opens a repo. One line on what you build beats a blank header.";

  return { lead, voice, pins, downplay };
}

function buildPresenceActions(payload) {
  const repos = payload?.analyzedRepos || [];
  const user = payload?.user || {};
  const focus = payload?.profileFocus?.top || [];
  const langs = payload?.languageSummary || [];
  const lang = primaryLang(langs);
  const ranked = topReposByImpressiveness(repos);
  const flagship = ranked[0];
  const n = repos.length || 1;
  const noDesc = repos.filter((a) => !a.repo.description || a.repo.description.length < 12);
  const quiet = repos.filter((a) => daysSince(a.repo.pushedAt) > 180);
  const hasProfileReadme = payload?.hasProfileReadme;
  const activity = payload?.activity || {};
  const actions = [];

  if (!user.bio || user.bio.length < 25) {
    const sample = buildTaglines(payload)[0]?.text || `${lang || "Software"} builder`;
    actions.push({
      id: "bio-tagline",
      priority: "high",
      title: "Set a one-line bio strangers can quote",
      why: "Recruiters decide in seconds. Your bio is the only sentence you control before they click a repo.",
      steps: [
        `Try something like: "${sample}"`,
        "GitHub → your profile → Edit profile → Bio (160 chars max).",
        "Match the bio to what you pin. Do not claim a focus your repos do not show.",
      ],
      evidence: [user.bio ? "Bio is very short" : "No bio set"],
    });
  }

  if (ranked.length >= 2) {
    const pinNames = ranked.slice(0, 3).map((a) => a.repo.name);
    actions.push({
      id: "pin-story",
      priority: "high",
      title: "Pin 3 repos that tell one story",
      why: "Pins are your portfolio above the fold. Random pins make you look unfocused.",
      steps: [
        `Pin in this order: ${pinNames.join(" → ")}.`,
        focus[0]
          ? `Each pin should reinforce ${focus[0].label.toLowerCase()} or your best ${lang || "stack"} work.`
          : "Pick repos with descriptions and recent commits, not old experiments.",
        "Unpin anything you would not want to explain in an interview.",
      ],
      evidence: pinNames.map((name) => `Candidate pin: ${name}`),
    });
  }

  if (flagship) {
    const name = flagship.repo.name;
    const weakOpen = !flagship.repo.description && !flagship.signals?.hasReadme;
    actions.push({
      id: "flagship-opening",
      priority: "high",
      title: `Make ${name} explain itself in 10 seconds`,
      why: "Your flagship is where most visitors land. They need problem → approach → demo, not folder spelunking.",
      steps: [
        `Open ${name} README. First paragraph: what it does, who it is for, one screenshot or command.`,
        flagship.oneLiner
          ? `Start from this angle: "${flagship.oneLiner.slice(0, 120)}"`
          : "Add a GitHub About description if the README is thin.",
        "Add 3-5 topics (framework, domain, language) so search and skim both work.",
      ],
      evidence: [
        weakOpen ? "Weak opening signals on flagship" : `Flagship: ${name}`,
        flagship.repo.language ? `${flagship.repo.language}` : null,
      ].filter(Boolean),
    });
  }

  if (!hasProfileReadme && user.login) {
    actions.push({
      id: "profile-readme",
      priority: "high",
      title: `Turn ${user.login}/${user.login} into a landing page`,
      why: "A profile README is the only place to curate your story on GitHub itself.",
      steps: [
        `Create repo \`${user.login}\` (same name as your username) with a README.`,
        "Top: one-line tagline. Middle: 3 pinned repos with one sentence each. Bottom: what you are exploring next.",
        "Link your best demo, not every repo you have ever touched.",
      ],
      evidence: ["No profile README detected"],
    });
  }

  if (noDesc.length >= 1) {
    actions.push({
      id: "repo-descriptions",
      priority: "medium",
      title: "Fill in bare repo descriptions",
      why: "Empty descriptions make the profile grid look abandoned even when the code is fine.",
      steps: [
        `Start with: ${noDesc
          .slice(0, 3)
          .map((a) => a.repo.name)
          .join(", ")}.`,
        "One concrete sentence per repo: what it does, not how you feel about it.",
        "Add topics that match your focus (e.g. machine-learning, cli, api).",
      ],
      evidence: noDesc.slice(0, 4).map((a) => `${a.repo.name}: no description`),
    });
  }

  if (payload?.activityImpression?.possiblyPrivate && activity.pushCount < 5) {
    actions.push({
      id: "surface-current-work",
      priority: "medium",
      title: "Show one slice of current work in public",
      why: "Your graph looks active but public repos are quiet. Visitors cannot see private work.",
      steps: [
        flagship
          ? `Small public update on ${flagship.repo.name}: changelog, WIP branch, or demo notes.`
          : "Pick one repo and push a visible update this week.",
        "Even a focused README update signals you are still building.",
        "Or write a short post/issue describing what you are working on.",
      ],
      evidence: [
        payload.activityImpression.yearCount != null
          ? `~${payload.activityImpression.yearCount} graph contributions`
          : "Busy contribution graph",
        `Only ${activity.pushCount || 0} public pushes in events sample`,
      ],
    });
  }

  if (quiet.length >= 2) {
    actions.push({
      id: "curate-dormant",
      priority: "medium",
      title: "Archive or label finished repos",
      why: "A wall of quiet projects reads as noise. Curating says you know what still matters.",
      steps: [
        `Review: ${quiet
          .slice(0, 3)
          .map((a) => a.repo.name)
          .join(", ")}.`,
        "Archive if done. Or add a README line: 'Finished / superseded by X'.",
        "Keep the public timeline focused on work you would still discuss.",
      ],
      evidence: quiet.slice(0, 3).map((a) => `${a.repo.name} (~${Math.round(daysSince(a.repo.pushedAt))}d quiet)`),
    });
  }

  if (focus.length >= 2) {
    actions.push({
      id: "focus-narrative",
      priority: "low",
      title: "Make your focus legible across repos",
      why: `You span ${focus[0].label} and ${focus[1].label}. Without a thread, it looks random.`,
      steps: [
        "Use consistent topics across related repos (same 2-3 tags).",
        "Mention the connection in your bio: 'X by day, Y experiments on the side.'",
        "Pin the repo that best represents the direction you want next.",
      ],
      evidence: focus.slice(0, 2).map((f) => `${f.label} ${f.score}/10`),
    });
  }

  if (actions.length < 3) {
    actions.push({
      id: "polish-presence",
      priority: "medium",
      title: "Run a 30-minute public presence pass",
      why: "Even strong profiles benefit from one intentional refresh.",
      steps: [
        "Bio + 3 pins + flagship README opening line.",
        "Archive one repo you would not discuss in an interview.",
        "Push one small visible update so 'last active' looks current.",
      ],
      evidence: [`${n} repos in sample`],
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  return actions.slice(0, 5);
}

/**
 * @returns {{ positioning: Object, actions: Array, starters: Array, forUser: string }}
 */
export function buildImprovements(payload) {
  const login = payload?.user?.login || "you";
  const positioning = {
    outsiderRead: buildOutsiderRead(payload),
    taglines: buildTaglines(payload),
    present: buildPresentYourself(payload),
  };

  return {
    positioning,
    actions: buildPresenceActions(payload),
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
  const focus = payload?.profileFocus?.top || [];
  const login = payload?.user?.login || "you";
  const lang = primaryLang(langs) || "your stack";
  const second = langs[1]?.name && langs[1].name !== lang ? langs[1].name : null;
  const ranked = topReposByImpressiveness(repos);
  const flagship = ranked[0];
  const primaryFocus = focus[0];
  const secondaryFocus = focus[1];
  const names = repos.map((a) => a.repo?.name).filter(Boolean);
  const topics = [...new Set(repos.flatMap((a) => a.repo?.topics || []))];
  const activity = payload?.activity || {};

  return {
    login,
    lang,
    second,
    repos,
    ranked,
    flagship: flagship?.repo?.name || `${login}-lab`,
    flagshipItem: flagship,
    primaryFocus,
    secondaryFocus,
    focus,
    topics,
    names,
    activity,
    possiblyPrivate: payload?.activityImpression?.possiblyPrivate,
  };
}

export function buildStarterPool(payload) {
  const c = starterContext(payload);
  const focusKey = c.primaryFocus?.key || "systems";
  const focusLabel = c.primaryFocus?.label || "Systems";
  const pool = [];

  pool.push({
    id: "starter-profile-readme",
    emoji: "✨",
    title: `${c.login}/${c.login}`,
    pitch: "Your profile README: tagline, 3 best repos, what you want to explore next. The only curated page on GitHub.",
    leapFrom: c.flagship
      ? `Feature ${c.flagship} first with a one-sentence hook.`
      : "Treat your profile as a landing page, not a file dump.",
    stack: ["profile", "markdown"],
    pillars: pillar("presence", focusKey),
  });

  const focusStarters = {
    ai: {
      emoji: "🤖",
      title: `${slug(c.lang)}-inference-demo`,
      pitch: `A tiny public demo: load a model, run one input, show output. README explains the idea in plain language.`,
      stack: [c.lang, "ML", "demo"],
    },
    llm: {
      emoji: "🧠",
      title: `${slug(c.lang)}-llm-sandbox`,
      pitch: "One focused LLM experiment with a clear README: what prompt, what model, what you learned.",
      stack: [c.lang, "LLM", "notebook"],
    },
    infra: {
      emoji: "🪨",
      title: "deploy-one-thing",
      pitch: "Deploy a single service with a diagram in the README. Shows you can ship, not just script locally.",
      stack: [c.lang, "infra", "docker"],
    },
    research: {
      emoji: "🔬",
      title: "repro-notebook",
      pitch: "One reproducible notebook or benchmark with a short methods section. Makes research taste visible.",
      stack: [c.lang, "research", "notebook"],
    },
    graphics: {
      emoji: "🎨",
      title: "one-visual-demo",
      pitch: "A small graphics or visual demo with a GIF in the README. Let the output sell the repo.",
      stack: [c.lang, "graphics", "demo"],
    },
    frontend: {
      emoji: "✨",
      title: "one-screen-ui",
      pitch: "Single-screen UI that does one thing well. Design and clarity are the whole point.",
      stack: [c.lang, "frontend", "ui"],
    },
    systems: {
      emoji: "⚙️",
      title: `mini-${slug(c.lang)}-service`,
      pitch: `A small ${c.lang} service with one API, a README strangers can run, and a clear problem statement.`,
      stack: [c.lang, "api"],
    },
    security: {
      emoji: "🔒",
      title: "security-lab",
      pitch: "Document one security concept you understand well. Teaching signal beats a vague hardening repo.",
      stack: [c.lang, "security"],
    },
    data: {
      emoji: "📊",
      title: "public-dataset-slice",
      pitch: "Publish a small, documented dataset or pipeline. Shows data taste without a massive project.",
      stack: [c.lang, "data"],
    },
    mobile: {
      emoji: "📱",
      title: "pocket-prototype",
      pitch: "One mobile screen or flow, screen-recorded in the README. Proof you ship interfaces.",
      stack: [c.lang, "mobile"],
    },
  };

  const themed = focusStarters[focusKey] || focusStarters.systems;
  pool.push({
    id: `starter-focus-${focusKey}`,
    ...themed,
    leapFrom: c.flagship
      ? `Carve the clearest idea from ${c.flagship} and make it standalone.`
      : `Ship a public hello-world in ${focusLabel.toLowerCase()}.`,
    pillars: pillar(focusKey),
  });

  if (c.secondaryFocus) {
    pool.push({
      id: "starter-bridge-focus",
      emoji: "🌉",
      title: `${slug(focusKey)}-${slug(c.secondaryFocus.key)}-kit`,
      pitch: `A small project at the intersection of ${c.primaryFocus.label} and ${c.secondaryFocus.label}.`,
      leapFrom: "Show how your two lanes connect instead of looking like random repos.",
      stack: [c.lang, c.primaryFocus.label, c.secondaryFocus.label],
      pillars: pillar(focusKey, c.secondaryFocus.key),
    });
  }

  const flagshipFocus = topFocusKeys(c.flagshipItem?.focusScores, 2);
  pool.push({
    id: "starter-showcase",
    emoji: "⭐",
    title: `${slug(c.flagship)}-v2`,
    pitch: "Rebuild your flagship idea with a cleaner README, better name, and one obvious demo path.",
    leapFrom: c.flagship
      ? `${c.flagship} has gravity. A polished v2 tells the same story with less friction.`
      : "Pick your best idea and make it interview-ready.",
    stack: [c.lang, "showcase"],
    pillars: pillar(...(flagshipFocus.length ? flagshipFocus : [focusKey]), "presence"),
  });

  if (c.possiblyPrivate || (c.activity.pushCount || 0) < 5) {
    pool.push({
      id: "starter-public-slice",
      emoji: "📣",
      title: "public-build-log",
      pitch: "A repo where you post weekly what you shipped, even if the real work is private. Makes momentum visible.",
      leapFrom: "Visitors cannot see private work. Give them a honest window.",
      stack: ["markdown", "log"],
      pillars: pillar("presence", focusKey),
    });
  }

  pool.push({
    id: "starter-tool",
    emoji: "⚡",
    title: `useful-${slug(c.lang)}-cli`,
    pitch: `A CLI that solves one problem you actually have. Small, named, easy to demo in 60 seconds.`,
    leapFrom: c.names[0]
      ? `Automate something ${c.names[0]} almost does.`
      : "Tools you use yourself read as real, not resume padding.",
    stack: [c.lang, "cli"],
    pillars: pillar("systems", focusKey),
  });

  if (c.topics[0]) {
    const topicPillars = inferPillarsFromText(c.topics[0]);
    pool.push({
      id: "starter-topic",
      emoji: "🏷️",
      title: `${slug(c.topics[0])}-explainer`,
      pitch: `A repo that teaches one idea in your "${c.topics[0]}" lane. README is the product.`,
      leapFrom: "Teaching signal helps recruiters understand depth fast.",
      stack: [c.lang, c.topics[0]],
      pillars: topicPillars.length ? topicPillars : pillar(focusKey, "research"),
    });
  }

  if (c.second) {
    pool.push({
      id: "starter-bridge-lang",
      emoji: "🔀",
      title: `${slug(c.lang)}-${slug(c.second)}-utility`,
      pitch: `A utility bridging ${c.lang} and ${c.second}. Cross-stack depth without looking scattered.`,
      leapFrom: "One bridge repo beats five unrelated ones.",
      stack: [c.lang, c.second],
      pillars: pillar(focusKey, "systems"),
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

function normalizeStarter(raw, index = 0, fallbackKeys = []) {
  if (!raw || typeof raw !== "object") return null;
  const title = slug(raw.title, `starter-${index + 1}`);
  const pitch = cleanStarterText(raw.pitch || raw.body || "");
  const leapFrom = cleanStarterText(raw.leapFrom || raw.leap || "");
  if (!pitch || !leapFrom) return null;
  const stack = Array.isArray(raw.stack)
    ? raw.stack.map((s) => cleanStarterText(s)).filter(Boolean).slice(0, 4)
    : [];
  const inferred = inferPillarsFromText(`${title} ${pitch} ${stack.join(" ")}`);
  const pillars = normalizePillars(raw.pillars, [
    ...inferred.map((p) => p.key),
    ...fallbackKeys,
  ]);
  return {
    id: String(raw.id || title),
    emoji: String(raw.emoji || "✦").slice(0, 4),
    title: String(raw.title || title).replace(/\u2014/g, "-").slice(0, 48),
    pitch,
    leapFrom,
    stack,
    pillars,
  };
}

function profileSketch(payload) {
  const c = starterContext(payload);
  const focus = (payload?.profileFocus?.top || []).map((f) => `${f.label} ${f.score}`).join(", ");
  const repoBits = (payload?.analyzedRepos || [])
    .slice(0, 8)
    .map((a) => {
      const topFocus = Object.entries(a.focusScores || {})
        .sort((x, y) => y[1] - x[1])[0];
      const focusBit = topFocus ? focusAreaLabel(topFocus[0]) : "";
      return `- ${a.repo?.name} (${a.repo?.language || "?"})${focusBit ? ` [${focusBit}]` : ""}${
        a.oneLiner ? `: ${String(a.oneLiner).slice(0, 80)}` : ""
      }`;
    })
    .join("\n");
  return [
    `User: @${c.login}`,
    `CS focus: ${focus || "(mixed)"}`,
    `Stack: ${[c.lang, c.second].filter(Boolean).join(", ")}`,
    `Flagship: ${c.flagship}`,
    `Outsider read: ${payload?.improvements?.positioning?.outsiderRead || buildOutsiderRead(payload)}`,
    "Repos:",
    repoBits || "(thin public sample)",
  ].join("\n");
}

export function refreshStartersHeuristic(payload, { seed = 0, excludeTitles = [], steer = "" } = {}) {
  const starters = pickStarters(buildStarterPool(payload), { count: 5, seed, excludeTitles });
  const direction = cleanStarterText(steer).slice(0, 160);
  const note = direction
    ? `A fresh batch aimed at "${direction}", still grounded in your public focus.`
    : "Five project ideas aligned with how your profile reads today.";
  return { starters, source: "heuristic", note };
}

export async function generateSteerStarters(payload, { steer = "", seed = 0, excludeTitles = [] } = {}) {
  const heuristic = refreshStartersHeuristic(payload, { seed, excludeTitles, steer });
  const direction = cleanStarterText(steer).slice(0, 280);

  const avoid = (excludeTitles || []).slice(0, 8).join(", ");
  const system = `You invent 5 small public GitHub projects to improve THIS person's public coding presence.
Think like a recruiter coach: projects should sharpen their story, focus area, and portfolio.
Weekend-scale, specific, grounded in their real repos and CS focus.
Never suggest "add tests" or "add CI" as the main pitch.
If they described a direction, steer toward it.
Leap from: name a real repo or public habit.
No em dashes. Product name is PokéGit.

Return ONLY JSON:
{
  "note": "one short sentence to the user about this batch",
  "starters": [
    {
      "emoji": "one emoji",
      "title": "kebab-case-repo-name",
      "pitch": "2 sentences",
      "leapFrom": "one sentence",
      "stack": ["lang", "theme"],
      "pillars": ["ai", "research"]
    }
  ]
}
Exactly 5 starters.
pillars: 1-3 keys from ai, llm, infra, research, graphics, frontend, systems, security, data, mobile, presence (portfolio/README), portfolio. Match the project's CS story.`;

  try {
    const result = await openaiChatJson({
      system,
      temperature: 0.9,
      maxTokens: 900,
      user: [
        profileSketch(payload),
        direction
          ? `\nDirection they asked for:\n${direction}`
          : "\nNo extra direction. Suggest projects that improve how they present publicly.",
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
    const focusKey = payload?.profileFocus?.top?.[0]?.key || "systems";
    const starters = (parsed?.starters || [])
      .map((s, i) => normalizeStarter(s, i, [focusKey]))
      .filter(Boolean)
      .slice(0, 5);
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
      note: cleanStarterText(parsed?.note || "") || "Five starters aimed at your public presence.",
    };
  } catch {
    return heuristic;
  }
}
