/**
 * Day-2 observations, evidence, and at-a-glance copy for PokéGit.
 * Observations > raw score dumps.
 */

import { activityVibe } from "./activity.js";
import {
  deriveBuilderHeadline,
  deriveBuilderOneLiner,
  focusAreaLabel,
  repoOneLiner,
} from "./focus.js";

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function ageYears(iso) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

function clampLabel(score) {
  if (score == null) return "unknown";
  if (score >= 8.5) return "clear strength";
  if (score >= 7) return "solid";
  if (score >= 5) return "mixed";
  return "thinner";
}

function repoNames(list, limit = 2) {
  return list
    .slice(0, limit)
    .map((a) => a.repo.name)
    .filter(Boolean);
}

/**
 * Build checklist evidence from the analyzed set.
 */
export function buildEvidence(analyzedRepos, profileFocus, activity = null, activityImpression = null) {
  const n = analyzedRepos.length || 1;
  const active90 = analyzedRepos.filter((a) => daysSince(a.repo.pushedAt) < 90).length;
  const topFocus = (profileFocus?.top || []).slice(0, 3);

  const items = [
    { ok: n >= 1, text: `${n} owned non-fork repositories analyzed` },
    { ok: topFocus.length > 0, text: `Strongest focus: ${topFocus.map((f) => f.label).join(", ") || "mixed"}` },
    { ok: active90 > 0, text: `${active90}/${n} pushed within the last 90 days` },
    {
      ok: (activity?.commitApprox || 0) > 0,
      text: activityImpression?.impression || activity?.sampleNote || "Public push activity sampled",
    },
  ];

  if (activityImpression?.yearCount != null) {
    items.push({
      ok: true,
      text: `~${activityImpression.yearCount} contributions on year graph${
        activityImpression.includesPrivate ? " (may include private)" : ""
      }`,
    });
  }

  if (activity?.pushCount > 0 || activity?.commitApprox > 0) {
    const pushLabel = activity.pushCount
      ? `${activity.pushCount} public pushes`
      : `≈${activity.commitApprox} public commits`;
    items.splice(3, 0, {
      ok: true,
      text: `${pushLabel} across ${activity.reposPushed?.length || activity.reposTouched?.length || 0} repos`,
    });
  }

  return items;
}

/**
 * Narrative observations with kind + evidence bullets.
 * kind: observed | inferred | uncertain
 */
export function buildObservations(
  analyzedRepos,
  profileFocus,
  languageSummary = [],
  activity = null,
  activityImpression = null
) {
  const n = analyzedRepos.length || 1;
  const langs = (languageSummary || []).map((l) => l.name);
  const observations = [];
  const topFocus = profileFocus?.top || [];

  // CS focus — lead with what they build
  if (topFocus.length >= 1 && topFocus[0].score >= 5) {
    const primary = topFocus[0];
    const secondary = topFocus[1];
    const focusRepos = analyzedRepos
      .filter((a) => (a.focusScores?.[primary.key] || 0) >= 6)
      .slice(0, 3);
    const names = repoNames(focusRepos.length ? focusRepos : analyzedRepos.slice(0, 2), 2);

    observations.push({
      id: "focus-primary",
      icon: primary.icon || "🎯",
      title:
        secondary && secondary.score >= 5
          ? `Builds in ${primary.label} with a ${secondary.label} streak`
          : `${primary.label} is the clearest through-line`,
      kind: "inferred",
      body:
        names.length > 0
          ? `Public repos like ${names.join(" & ")} reinforce a ${primary.label.toLowerCase()} identity${
              secondary ? `, with ${secondary.label.toLowerCase()} showing up too` : ""
            }.`
          : `Across the sample, ${primary.label.toLowerCase()} signals dominate.`,
      evidence: [
        `${primary.label} ${primary.score}/10`,
        secondary ? `${secondary.label} ${secondary.score}/10` : null,
        ...focusRepos.slice(0, 2).map((a) => a.repo.name),
      ].filter(Boolean),
      dim: primary.key,
      score: primary.score,
    });
  }

  // Activity + public vs private read
  if (activityImpression?.possiblyPrivate) {
    observations.push({
      id: "activity-private-hint",
      icon: "🌙",
      title: "Busy on the graph, quiet in public repos",
      kind: "inferred",
      body: activityImpression.impression,
      evidence: [
        activityImpression.yearCount != null ? `~${activityImpression.yearCount} year contributions` : null,
        activityImpression.includesPrivate ? "Graph may count private work" : null,
        activity?.commitApprox ? `≈${activity.commitApprox} public commits in events` : "Few public push events",
      ].filter(Boolean),
      dim: "activity",
      score: null,
    });
  } else if (activity?.commitApprox >= 12 || activity?.pushCount >= 8 || activity?.label === "hot" || activity?.label === "active") {
    const top = (activity.reposPushed || activity.reposTouched || []).slice(0, 2).map((r) => r.name);
    const pushN = activity.pushCount ?? activity.pushEvents ?? 0;
    observations.push({
      id: "activity-hot",
      icon: "🚀",
      title:
        pushN > 0
          ? `${pushN} recent public push${pushN === 1 ? "" : "es"}${top.length ? ` in ${top.join(" & ")}` : ""}`
          : activity.commitApprox > 0
            ? `≈${activity.commitApprox} recent public commits${top.length ? ` in ${top.join(" & ")}` : ""}`
            : `${activity.active30 || 0} repos moved in the last month`,
      kind: "observed",
      body: activityImpression?.impression || activity.sampleNote || `Public push events show ${activityVibe(activity)}.`,
      evidence: [
        activity.commitApprox > 0 ? `≈${activity.commitApprox} commits in public events` : null,
        ...(activity.reposTouched || []).slice(0, 3).map((r) => `${r.name}: ~${r.commits || "?"} commits`),
      ].filter(Boolean),
      dim: "activity",
      score: null,
    });
  } else if (activity?.label === "quiet" || activity?.label === "dormant") {
    observations.push({
      id: "activity-quiet",
      icon: "🚀",
      title:
        activity.newestRepoName && activity.newestPushDays != null
          ? `Public work quiet. Last push ~${activity.newestPushDays}d ago on ${activity.newestRepoName}`
          : "Public commits have been sparse lately",
      kind: "observed",
      body:
        activityImpression?.impression ||
        "That can mean finished projects or private work elsewhere.",
      evidence: analyzedRepos
        .slice(0, 3)
        .map((a) => `${a.repo.name}: ~${Math.round(daysSince(a.repo.pushedAt))}d since push`),
      dim: "activity",
      score: null,
    });
  }

  // Language / stack pattern
  if (langs.length >= 2) {
    const top = langs.slice(0, 3).join(" + ");
    observations.push({
      id: "stack-pattern",
      icon: "🧩",
      title: `${langs[0]} + ${langs[1]} keep showing up`,
      kind: "inferred",
      body: `Their public work repeatedly surfaces ${top}, which usually means depth in that stack rather than random hopping.`,
      evidence: (languageSummary || []).slice(0, 3).map((l) => `${l.name} ~${l.percent}% of sample weight`),
      dim: "stack",
      score: null,
    });
  } else if (langs[0]) {
    observations.push({
      id: "lang-focus",
      icon: "🧩",
      title: `${langs[0]} looks like home base`,
      kind: "observed",
      body: `Most analyzed weight sits in ${langs[0]}.`,
      evidence: [`Primary language: ${langs[0]}`],
      dim: "stack",
      score: null,
    });
  }

  // Standout repo by stars + focus
  const byStars = [...analyzedRepos].sort((a, b) => (b.repo.stargazers || 0) - (a.repo.stargazers || 0));
  const flagship = byStars.find((a) => (a.repo.stargazers || 0) >= 15);
  if (flagship) {
    const topKey = Object.entries(flagship.focusScores || {}).sort((a, b) => b[1] - a[1])[0];
    observations.push({
      id: "flagship-repo",
      icon: "⭐",
      title: `${flagship.repo.name} is the gravity well (${flagship.repo.stargazers}★)`,
      kind: "observed",
      body: topKey
        ? `Reads as ${focusAreaLabel(topKey[0]).toLowerCase()} work. ${repoOneLiner(flagship.repo, flagship.pokemon, flagship.signals)}`
        : repoOneLiner(flagship.repo, flagship.pokemon, flagship.signals),
      evidence: [
        `${flagship.repo.stargazers} stars`,
        `Last push ~${Math.round(daysSince(flagship.repo.pushedAt))}d ago`,
      ],
      dim: topKey?.[0] || null,
      score: topKey?.[1] || null,
    });
  }

  if (observations.length < 2) {
    observations.push({
      id: "uncertain-thin",
      icon: "❔",
      title: "Public sample is thin. Read lightly",
      kind: "uncertain",
      body: "Enough to sketch a silhouette, not enough for a biography. Lean on named repos and recent pushes over vibes.",
      evidence: [`Only ${n} repos in the analysis set`],
      dim: null,
      score: null,
    });
  }

  return observations.slice(0, 5);
}

/**
 * 1–3 surprising cross-repo patterns. Empty array if nothing credible.
 * Never invent filler.
 */
export function buildSurprises(analyzedRepos, profileFocus, languageSummary = []) {
  const n = analyzedRepos.length;
  if (n < 2) return [];

  const surprises = [];
  const oldAlive = analyzedRepos.filter(
    (a) => ageYears(a.repo.createdAt) >= 3 && daysSince(a.repo.pushedAt) < 120
  );
  const bigQuiet = analyzedRepos.filter(
    (a) => (a.repo.stargazers || 0) >= 80 && daysSince(a.repo.pushedAt) > 400
  );

  const byPush = [...analyzedRepos].sort(
    (a, b) => new Date(b.repo.pushedAt) - new Date(a.repo.pushedAt)
  );
  const recentLangs = new Set(byPush.slice(0, Math.min(3, n)).map((a) => a.repo.language).filter(Boolean));
  const olderLangs = new Set(byPush.slice(-Math.min(3, n)).map((a) => a.repo.language).filter(Boolean));
  const recentOnly = [...recentLangs].filter((l) => !olderLangs.has(l));
  const olderOnly = [...olderLangs].filter((l) => !recentLangs.has(l));

  const topFocus = profileFocus?.top || [];
  if (topFocus.length >= 2 && topFocus[0].score >= 6 && topFocus[1].score >= 5) {
    surprises.push({
      id: "dual-focus",
      icon: "🔀",
      title: `Spans ${topFocus[0].label} and ${topFocus[1].label}`,
      kind: "inferred",
      body: `Not a single-lane builder. Public repos show real weight in both areas.`,
      evidence: topFocus.slice(0, 2).map((f) => `${f.label} ${f.score}/10`),
    });
  }

  if (oldAlive.length >= 2) {
    surprises.push({
      id: "long-care",
      icon: "⏳",
      title: "They keep old projects alive",
      kind: "observed",
      body: `${oldAlive.length} repositories are 3+ years old and still saw pushes in the last ~4 months.`,
      evidence: oldAlive.slice(0, 3).map((a) => `${a.repo.name} (~${ageYears(a.repo.createdAt).toFixed(1)}y)`),
    });
  }

  const langs = (languageSummary || []).map((l) => l.name);
  if (langs.length >= 2 && (languageSummary[0]?.percent || 0) >= 55) {
    surprises.push({
      id: "home-base",
      icon: "🏠",
      title: `${langs[0]} is a real home base`,
      kind: "observed",
      body: `About ${languageSummary[0].percent}% of analyzed weight sits in ${langs[0]}.`,
      evidence: languageSummary.slice(0, 3).map((l) => `${l.name} ~${l.percent}%`),
    });
  }

  if (recentOnly.length && olderOnly.length && n >= 4) {
    surprises.push({
      id: "lang-shift",
      icon: "🔀",
      title: "Recent work may be shifting stacks",
      kind: "inferred",
      body: `Newer pushes surface ${recentOnly.slice(0, 2).join(" / ")}, while older work leans ${olderOnly
        .slice(0, 2)
        .join(" / ")}.`,
      evidence: [
        `Recent langs: ${[...recentLangs].join(", ") || "-"}`,
        `Older langs: ${[...olderLangs].join(", ") || "-"}`,
      ],
    });
  }

  if (bigQuiet.length === 1 && n >= 3) {
    const r = bigQuiet[0].repo;
    surprises.push({
      id: "quiet-star",
      icon: "⭐",
      title: "A high-gravity repo has gone quiet",
      kind: "observed",
      body: `${r.name} still carries ${r.stargazers}★ but hasn't moved in a long while. May simply be finished.`,
      evidence: [`${r.name}: ${r.stargazers}★`, `~${Math.round(daysSince(r.pushedAt))}d since push`],
    });
  }

  return surprises.slice(0, 3);
}

/**
 * At-a-glance headline + strongest dims + one-liner.
 * Answers: "What kind of engineer is this?"
 */
export function buildGlance(
  user,
  profileFocus,
  observations,
  summary,
  languageSummary = [],
  activity = null,
  activityImpression = null,
  contributionPulse = null
) {
  const ranked = (profileFocus?.top || []).map((d) => ({
    key: d.key,
    label: d.label,
    icon: d.icon,
    score: d.score,
  }));

  const strongest = ranked.slice(0, 4);

  const derived = deriveBuilderHeadline(user, profileFocus, languageSummary, activity, {
    ...contributionPulse,
    possiblyPrivate: activityImpression?.possiblyPrivate,
  });
  const rawHeadline = summary?.glanceHeadline || derived;
  const headline = isGenericHeadline(rawHeadline) ? derived : rawHeadline;

  const derivedOne = deriveBuilderOneLiner(profileFocus, activity, {
    ...contributionPulse,
    possiblyPrivate: activityImpression?.possiblyPrivate,
  });
  const rawOne = summary?.oneLiner || derivedOne;
  const oneLiner =
    (isGenericOneLiner(rawOne) ? derivedOne : rawOne) ||
    "A partial silhouette from their public repos.";

  return {
    headline,
    oneLiner,
    strongest,
    allScores: ranked,
  };
}

function isGenericHeadline(h) {
  const s = String(h || "").trim();
  if (!s) return true;
  return /public github engineer/i.test(s) || /^engineer$/i.test(s);
}

function isGenericOneLiner(h) {
  const s = String(h || "").trim();
  if (!s) return true;
  return (
    /limited testing infrastructure is visible/i.test(s) ||
    /test-oriented/i.test(s) ||
    /maintenance-minded/i.test(s)
  );
}

/** Per-repo drill-down payload. */
export function buildRepoDrilldown(item) {
  const { repo, signals, pokemon, focusScores, oneLiner } = item;
  const years = ageYears(repo.createdAt);
  const days = Math.round(daysSince(repo.pushedAt));

  const topFocus = Object.entries(focusScores || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${focusAreaLabel(k)} ${v}/10`);

  const interesting = [
    years >= 1 ? `${years.toFixed(1)} years old` : "Younger than a year",
    days < 90 ? "Still actively maintained" : days < 365 ? "Touched within a year" : "Quiet lately",
    repo.language ? `${repo.language}-heavy` : null,
    (repo.stargazers || 0) >= 20 ? `${repo.stargazers} stars` : null,
    (repo.topics || []).length ? `Topics: ${repo.topics.slice(0, 4).join(", ")}` : null,
    signals.recentCommitApprox ? `≈${signals.recentCommitApprox} recent public commits` : null,
  ].filter(Boolean);

  const roleGuess =
    topFocus[0]?.split(" ")[0] ||
    (pokemon.tags?.includes("Frontend")
      ? "Frontend"
      : pokemon.tags?.includes("Infra")
        ? "Infrastructure"
        : pokemon.tags?.includes("ML")
          ? "AI / ML"
          : repo.language || "Project");

  return {
    roleGuess,
    checks: [],
    interesting,
    whyTitle: "What this repo is",
    whyBody: oneLiner || repoOneLiner(repo, pokemon, signals),
    personality: pokemon.personality || pokemon.blurb,
    focusLines: topFocus,
  };
}

export { clampLabel, daysSince, ageYears };
