/**
 * Select top repos and enrich with filesystem / CI / docs signals.
 */

import { request, GitHubError } from "./github-request.js";

const ROOT_TEST_HINTS = [
  "test",
  "tests",
  "testing",
  "__tests__",
  "spec",
  "specs",
  "jest.config",
  "vitest.config",
  "pytest.ini",
  "phpunit",
  "cypress",
  "playwright",
];

const CI_HINTS = [
  ".github",
  ".gitlab-ci.yml",
  ".circleci",
  ".travis.yml",
  "Jenkinsfile",
  "azure-pipelines",
  "buildkite",
  "bitbucket-pipelines",
];

const DOC_HINTS = ["readme", "docs", "documentation", "contributing", "wiki"];

/**
 * Rank owned repos for analysis (stars + recency + size). Top N, non-archived preferred.
 */
export function selectTopRepos(repos, limit = 8) {
  const now = Date.now();
  const scored = repos
    .filter((r) => !r.disabled)
    .map((r) => {
      const daysSincePush = Math.max(
        0,
        (now - new Date(r.pushedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      const recency = Math.max(0, 1 - daysSincePush / 730); // decay over ~2y
      const starScore = Math.log10((r.stargazers || 0) + 1);
      const sizeScore = Math.min(2, Math.log10((r.size || 1) + 1));
      const archivedPenalty = r.archived ? 0.35 : 1;
      const relevance = (starScore * 2.2 + recency * 3.5 + sizeScore * 0.8) * archivedPenalty;
      return { repo: r, relevance };
    })
    .sort((a, b) => b.relevance - a.relevance);

  // Prefer non-archived; still allow archived if that's all they have
  const live = scored.filter((s) => !s.repo.archived);
  const pick = (live.length >= 3 ? live : scored).slice(0, limit);
  return pick.map((s) => s.repo);
}

function nameMatches(name, hints) {
  const lower = name.toLowerCase();
  return hints.some((h) => lower === h || lower.startsWith(h) || lower.includes(h));
}

/**
 * Inspect a repo root listing for test/CI/docs signals.
 */
export async function inspectRepoSignals(owner, repo) {
  const signals = {
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

  try {
    const { data } = await request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/`
    );
    if (Array.isArray(data)) {
      signals.rootFiles = data.map((f) => f.name);
      for (const f of data) {
        const n = f.name.toLowerCase();
        if (n.startsWith("readme")) signals.hasReadme = true;
        if (n === "contributing.md" || n === "contributing") signals.hasContributing = true;
        if (n === "license" || n.startsWith("license")) signals.hasLicenseFile = true;
        if (n === "docs" || n === "documentation") signals.hasDocs = true;
        if (nameMatches(f.name, ROOT_TEST_HINTS)) signals.hasTests = true;
        if (nameMatches(f.name, CI_HINTS)) signals.hasCi = true;
      }

      // Peek into .github for workflows
      if (data.some((f) => f.name === ".github" && f.type === "dir")) {
        try {
          const { data: gh } = await request(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.github`
          );
          if (Array.isArray(gh)) {
            if (gh.some((f) => f.name === "workflows")) signals.hasCi = true;
            if (gh.some((f) => f.name.toLowerCase() === "dependabot.yml")) signals.hasCi = true;
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    if (err.status !== 404) {
      // empty repo or blocked — keep defaults
    }
  }

  // Latest release (cheap signal for maintenance)
  try {
    const { data } = await request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=1`
    );
    if (Array.isArray(data) && data[0]) {
      signals.recentRelease = {
        tag: data[0].tag_name,
        publishedAt: data[0].published_at,
      };
    }
  } catch {
    /* no releases */
  }

  return signals;
}

export { GitHubError };
