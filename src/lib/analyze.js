/**
 * Full profile analysis orchestration for PokéGit v1.
 */

import { request, GitHubError } from "./github-request.js";
import { selectTopRepos, inspectRepoSignals } from "./inspect.js";
import { scoreRepo, aggregateProfileScores } from "./score.js";
import { assignPokemon } from "./pokemon.js";
import { generateSummary } from "./summarize.js";

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
  const repos = [];
  let rateLimitRemaining = null;

  for (let page = 1; page <= 2; page++) {
    const { data, rateLimitRemaining: rem } = await request(
      `/users/${encodeURIComponent(username)}/repos?sort=updated&direction=desc&per_page=30&page=${page}&type=owner`
    );
    rateLimitRemaining = rem;
    if (!Array.isArray(data) || data.length === 0) break;

    for (const r of data) {
      if (r.fork) continue;
      repos.push({
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
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        pushedAt: r.pushed_at,
      });
    }
    if (data.length < 30) break;
  }

  return { repos, rateLimitRemaining };
}

/**
 * @param {string} username
 * @param {(phase: string) => void} [onProgress]
 */
export async function analyzeProfile(username, onProgress = () => {}) {
  onProgress("profile");
  const { user, rateLimitRemaining: rem1 } = await fetchUser(username);

  if (user.type === "Organization") {
    return {
      insufficient: true,
      insufficientReason:
        "This is an organization account. PokéGit analyzes individual engineer profiles.",
      user,
      analyzedRepos: [],
      profileScores: {},
      summary: {
        text: "This is an organization account. PokéGit analyzes individual engineer profiles.",
        source: "heuristic",
      },
      rateLimitRemaining: rem1,
      fetchedAt: new Date().toISOString(),
    };
  }

  onProgress("repos");
  const { repos, rateLimitRemaining: rem2 } = await fetchRepos(username);

  if (!repos.length) {
    return {
      insufficient: true,
      insufficientReason:
        "Not enough public data. No owned, non-fork repositories were found on this profile.",
      user,
      analyzedRepos: [],
      profileScores: { enoughData: false },
      summary: {
        text: "Not enough public data. No owned, non-fork repositories were found on this profile.",
        source: "heuristic",
      },
      rateLimitRemaining: rem2 ?? rem1,
      fetchedAt: new Date().toISOString(),
    };
  }

  const top = selectTopRepos(repos, 6);
  onProgress("inspect");

  const analyzedRepos = await Promise.all(
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
        };
      }
      const scores = scoreRepo(repo, signals);
      const pokemon = assignPokemon(repo, scores, signals);
      return { repo, signals, scores, pokemon };
    })
  );

  const profileScores = aggregateProfileScores(analyzedRepos);

  // Extremely thin profiles
  const totalStars = analyzedRepos.reduce((s, a) => s + (a.repo.stargazers || 0), 0);
  const anySignal = analyzedRepos.some(
    (a) => a.signals.hasTests || a.signals.hasCi || a.signals.hasReadme || a.repo.stargazers > 0
  );

  let insufficient = false;
  let insufficientReason = null;
  if (analyzedRepos.length === 1 && totalStars === 0 && !anySignal) {
    insufficient = true;
    insufficientReason =
      "Not enough public data. This profile's public repos don't expose enough signals for a meaningful report yet.";
  }

  const draft = {
    user,
    analyzedRepos,
    profileScores,
    insufficient,
    insufficientReason,
    repoUniverseSize: repos.length,
    rateLimitRemaining: rem2 ?? rem1,
    fetchedAt: new Date().toISOString(),
  };

  onProgress("summary");
  const summary = await generateSummary(draft);
  if (insufficient) {
    summary.text = insufficientReason;
    summary.source = "heuristic";
  }

  return { ...draft, summary };
}

/** @deprecated use analyzeProfile */
export async function fetchProfileBundle(username) {
  return analyzeProfile(username);
}
