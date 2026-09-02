/**
 * PokéGit analysis orchestration (Day 2: observations + evidence + drill-down).
 */

import { request, GitHubError } from "./github-request.js";
import { selectTopRepos, inspectRepoSignals } from "./inspect.js";
import { scoreRepo, aggregateProfileScores } from "./score.js";
import { assignPokemon } from "./pokemon.js";
import { generateSummary, detectAiAssistance } from "./summarize.js";
import {
  buildObservations,
  buildEvidence,
  buildGlance,
  buildRepoDrilldown,
  buildSurprises,
} from "./insights.js";
import { buildImprovements } from "./improve.js";
import { summarizePublicActivity, buildWeeklyPublicActivity, buildActivityImpression, buildActivityDashboard } from "./activity.js";
import { fetchContributionPulse } from "./contributions.js";
import {
  scoreRepoFocus,
  aggregateProfileFocus,
  repoOneLiner,
} from "./focus.js";

export { GitHubError };

async function fetchUser(username) {
  const { data, rateLimitRemaining } = await request(`/users/${encodeURIComponent(username)}`);
  return {
    user: {
      login: data.login,
      name: data.name,
      bio: data.bio,
      avatarUrl: data.avatar_url,
      htmlUrl: data.html_url,
      company: data.company,
      location: data.location,
      blog: data.blog,
      publicRepos: data.public_repos,
      followers: data.followers,
      following: data.following,
      createdAt: data.created_at,
      type: data.type,
    },
    rateLimitRemaining,
  };
}

async function fetchRepos(username) {
  const owned = [];
  let forkCount = 0;
  let rateLimitRemaining = null;

  for (let page = 1; page <= 2; page++) {
    const { data, rateLimitRemaining: rem } = await request(
      `/users/${encodeURIComponent(username)}/repos?sort=updated&direction=desc&per_page=30&page=${page}&type=owner`
    );
    rateLimitRemaining = rem;
    if (!Array.isArray(data) || data.length === 0) break;

    for (const r of data) {
      if (r.fork) {
        forkCount += 1;
        continue; // forks are not treated as original engineering work
      }
      owned.push({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        htmlUrl: r.html_url,
        language: r.language,
        stargazers: r.stargazers_count,
        forks: r.forks_count,
        watchers: r.watchers_count,
        openIssues: r.open_issues_count,
        size: r.size,
        topics: r.topics || [],
        license: r.license?.spdx_id || null,
        archived: r.archived,
        disabled: r.disabled,
        isFork: false,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        pushedAt: r.pushed_at,
      });
    }
    if (data.length < 30) break;
  }

  return { repos: owned, forkCount, rateLimitRemaining };
}

/** Recent PushEvents (~90d). Paginate because commit counts are often stripped. */
async function fetchPublicEvents(username) {
  const events = [];
  let rateLimitRemaining = null;
  try {
    for (let page = 1; page <= 3; page++) {
      const { data, rateLimitRemaining: rem } = await request(
        `/users/${encodeURIComponent(username)}/events/public?per_page=100&page=${page}`
      );
      rateLimitRemaining = rem;
      if (!Array.isArray(data) || data.length === 0) break;
      events.push(...data);
      if (data.length < 100) break;
    }
  } catch {
    return { events: [], rateLimitRemaining };
  }
  return { events, rateLimitRemaining };
}

function languageSummary(repos) {
  const totals = {};
  for (const r of repos) {
    if (!r.language) continue;
    totals[r.language] = (totals[r.language] || 0) + Math.max(r.size || 1, 1);
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(totals)
    .map(([name, w]) => ({ name, percent: Math.round((w / sum) * 1000) / 10 }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 8);
}

function emptySummary(reason) {
  return {
    style: "",
    glanceHeadline: "",
    oneLiner: "",
    strengths: [],
    interesting: [],
    concerns: [{ text: reason, kind: "uncertain" }],
    greens: [],
    reds: [reason],
    text: reason,
    aiAssistance: {
      level: "none",
      confidence: "medium",
      label: "Little or no public evidence",
      evidence: [],
      summary: "Not enough public data to comment on AI-assisted development.",
    },
    source: "heuristic",
  };
}

export async function analyzeProfile(username, onProgress = () => {}) {
  onProgress("profile");
  const { user, rateLimitRemaining: rem1 } = await fetchUser(username);

  if (user.type === "Organization") {
    const reason = "Not enough public information to generate a meaningful profile. This looks like an organization, not an individual engineer.";
    return {
      insufficient: true,
      insufficientReason: reason,
      user,
      analyzedRepos: [],
      profileScores: { enoughData: false },
      languageSummary: [],
      observations: [],
      evidence: [],
      surprises: [],
      glance: null,
      forkCount: 0,
      summary: emptySummary(reason),
      rateLimitRemaining: rem1,
      fetchedAt: new Date().toISOString(),
    };
  }

  onProgress("repos");
  const { repos, forkCount, rateLimitRemaining: rem2 } = await fetchRepos(username);

  if (!repos.length) {
    const reason =
      forkCount > 0
        ? "Not enough public information to generate a meaningful profile. Public repos here are mostly forks, which aren't counted as original engineering work."
        : "Not enough public information to generate a meaningful profile.";
    return {
      insufficient: true,
      insufficientReason: reason,
      user,
      analyzedRepos: [],
      profileScores: { enoughData: false },
      languageSummary: [],
      observations: [],
      evidence: [],
      surprises: [],
      glance: null,
      forkCount,
      summary: emptySummary(reason),
      rateLimitRemaining: rem2 ?? rem1,
      fetchedAt: new Date().toISOString(),
    };
  }

  // Cap analysis set: never try to inspect hundreds of repos
  const top = selectTopRepos(repos, 8);
  onProgress("inspect");

  const [{ events, rateLimitRemaining: remEvents }, contributionPulse, analyzedRepos] = await Promise.all([
    fetchPublicEvents(user.login),
    fetchContributionPulse(user.login),
    Promise.all(
      top.map(async (repo) => {
        let signals;
        try {
          signals = await inspectRepoSignals(user.login, repo.name);
        } catch {
          signals = {
            hasReadme: false,
            hasDocs: false,
            hasContributing: false,
            hasTests: false,
            hasCi: false,
            hasLicenseFile: false,
            rootFiles: [],
            recentRelease: null,
            commitSampleCount: null,
          };
        }
        const scores = scoreRepo(repo, signals);
        const pokemon = assignPokemon(repo, scores, signals);
        signals.focusTags = pokemon.tags || [];
        const focusScores = scoreRepoFocus(repo, signals);
        const item = { repo, signals, scores, focusScores, pokemon };
        item.oneLiner = repoOneLiner(repo, pokemon, signals);
        item.drilldown = buildRepoDrilldown(item);
        return item;
      })
    ),
  ]);

  const profileScores = aggregateProfileScores(analyzedRepos);
  const profileFocus = aggregateProfileFocus(analyzedRepos);
  const langs = languageSummary(repos);
  const activity = summarizePublicActivity(events, {
    analyzedRepos,
    profileActivityScore: profileScores.activity,
  });
  const weeklyActivity = buildWeeklyPublicActivity(events, repos, 12);
  const activityImpression = buildActivityImpression(activity, contributionPulse, weeklyActivity);
  const activityDashboard = buildActivityDashboard({
    activity,
    pulse: contributionPulse,
    impression: activityImpression,
    weekly: weeklyActivity,
    analyzedRepos,
    allRepos: repos,
    languageSummary: langs,
    profileFocus,
  });

  // Attach per-repo recent push/commit estimates from public events
  for (const item of analyzedRepos) {
    const pushes = activity.reposPushed?.find((r) => r.name === item.repo.name)?.pushes;
    const commits = activity.commitsByRepo?.[item.repo.name];
    const n = pushes ?? commits;
    if (n != null) {
      item.signals.commitSampleCount = n;
      item.signals.recentCommitApprox = n;
      item.signals.recentPushCount = pushes ?? null;
    }
  }

  const aiAssistanceHeuristic = detectAiAssistance(analyzedRepos);
  const observations = buildObservations(analyzedRepos, profileFocus, langs, activity, activityImpression);
  const evidence = buildEvidence(analyzedRepos, profileFocus, activity, activityImpression);
  const surprises = buildSurprises(analyzedRepos, profileFocus, langs);

  const totalStars = analyzedRepos.reduce((s, a) => s + (a.repo.stargazers || 0), 0);
  const anySignal = analyzedRepos.some(
    (a) => a.signals.hasTests || a.signals.hasCi || a.signals.hasReadme || a.repo.stargazers > 0
  );

  let insufficient = false;
  let insufficientReason = null;
  if (analyzedRepos.length === 1 && totalStars === 0 && !anySignal) {
    insufficient = true;
    insufficientReason = "Not enough public information to generate a meaningful profile.";
  }

  const analyzedAt = new Date().toISOString();
  const hasProfileReadme = repos.some(
    (r) => r.name.toLowerCase() === String(user.login || "").toLowerCase()
  );
  const draft = {
    user,
    analyzedRepos,
    profileScores,
    profileFocus,
    languageSummary: langs,
    activity,
    activityImpression,
    activityDashboard,
    contributionPulse,
    hasProfileReadme,
    forkCount,
    aiAssistanceHeuristic,
    observations,
    evidence,
    surprises,
    insufficient,
    insufficientReason,
    repoUniverseSize: repos.length,
    rateLimitRemaining: remEvents ?? rem2 ?? rem1,
    fetchedAt: analyzedAt,
    analyzedAt,
  };

  onProgress("summary");
  let summary;
  try {
    summary = await generateSummary(draft);
  } catch {
    summary = {
      ...emptySummary("AI insights unavailable."),
      unavailable: true,
      strengths: [
        {
          text: "GitHub analysis completed without the language model.",
          kind: "observed",
        },
      ],
      style: "Structured scores and Pokémon assignments are still available from public repo signals.",
      source: "heuristic",
      aiAssistance: aiAssistanceHeuristic,
    };
  }

  if (insufficient) {
    summary = emptySummary(insufficientReason);
  }

  const glance = buildGlance(
    user,
    profileFocus,
    observations,
    summary,
    langs,
    activity,
    activityImpression,
    contributionPulse
  );
  const improvements = insufficient ? null : buildImprovements({ ...draft, summary, glance });
  return { ...draft, summary, glance, improvements };
}

export async function fetchProfileBundle(username) {
  return analyzeProfile(username);
}
