/**
 * Experimental engineering scores from public signals.
 * Explicitly imperfect — used for relative profile shape, not hiring judgments.
 */

function clamp(n, min = 0, max = 10) {
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
}

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Per-repo dimensional scores (0–10).
 */
export function scoreRepo(repo, signals = {}) {
  const days = daysSince(repo.pushedAt);
  const ageYears = Math.max(
    0.1,
    (Date.now() - new Date(repo.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  );

  // Maintenance: recency, releases, not archived, open issues as weak activity
  let maintenance = 4;
  if (days < 30) maintenance += 4;
  else if (days < 90) maintenance += 3;
  else if (days < 180) maintenance += 2;
  else if (days < 365) maintenance += 0.5;
  else maintenance -= 2;
  if (signals.recentRelease && daysSince(signals.recentRelease.publishedAt) < 365) maintenance += 1.2;
  if (repo.archived) maintenance = Math.min(maintenance, 3);
  if ((repo.openIssues || 0) > 0 && (repo.openIssues || 0) < 50) maintenance += 0.3;

  // Popularity
  const stars = repo.stargazers || 0;
  let popularity = Math.min(9.5, Math.log10(stars + 1) * 2.8);
  popularity += Math.min(1.5, Math.log10((repo.forks || 0) + 1));

  // Testing
  let testing = 2.5;
  if (signals.hasTests) testing += 4.5;
  if (signals.hasCi) testing += 2.5;
  if (signals.hasTests && signals.hasCi) testing += 0.5;

  // Documentation
  let documentation = 2;
  if (signals.hasReadme) documentation += 3.5;
  if (signals.hasDocs) documentation += 2.5;
  if (signals.hasContributing) documentation += 1.5;
  if (repo.description && repo.description.length > 20) documentation += 0.8;
  if ((repo.topics || []).length >= 3) documentation += 0.5;

  // Code quality proxy (structure signals only — not real code review)
  let codeQuality = 4.5;
  if (signals.hasTests) codeQuality += 1.5;
  if (signals.hasCi) codeQuality += 1.2;
  if (signals.hasLicenseFile || repo.license) codeQuality += 0.6;
  if (repo.language) codeQuality += 0.4;
  if ((repo.size || 0) > 50 && (repo.size || 0) < 200000) codeQuality += 0.5;
  if (repo.archived) codeQuality -= 1.5;
  // Mature repos that stay updated look more disciplined
  if (ageYears >= 2 && days < 180) codeQuality += 0.8;

  // Technology richness (language/topics — not a quality judgment)
  let technology = 4;
  if (repo.language) technology += 2;
  technology += Math.min(2, (repo.topics || []).length * 0.4);
  const hay = `${(repo.topics || []).join(" ")} ${repo.description || ""}`.toLowerCase();
  if (/typescript|rust|go|kotlin|swift/.test(hay) || /TypeScript|Rust|Go|Kotlin|Swift/.test(repo.language || "")) {
    technology += 0.5;
  }

  return {
    codeQuality: clamp(codeQuality),
    testing: clamp(testing),
    maintenance: clamp(maintenance),
    documentation: clamp(documentation),
    popularity: clamp(popularity),
    technology: clamp(technology),
  };
}

/**
 * Aggregate profile scores from analyzed repos.
 * Weights favor larger / more starred / more maintained repos.
 */
export function aggregateProfileScores(analyzedRepos) {
  if (!analyzedRepos.length) {
    return {
      codeQuality: null,
      testing: null,
      maintenance: null,
      documentation: null,
      enoughData: false,
    };
  }

  const dims = ["codeQuality", "testing", "maintenance", "documentation"];
  const totals = Object.fromEntries(dims.map((d) => [d, { w: 0, s: 0 }]));

  for (const item of analyzedRepos) {
    const weight =
      Math.log10((item.repo.stargazers || 0) + 10) *
      (item.repo.archived ? 0.4 : 1) *
      (daysSince(item.repo.pushedAt) < 365 ? 1.2 : 0.8);
    for (const d of dims) {
      totals[d].s += item.scores[d] * weight;
      totals[d].w += weight;
    }
  }

  const out = {};
  for (const d of dims) {
    out[d] = totals[d].w ? clamp(totals[d].s / totals[d].w) : null;
  }
  out.enoughData = analyzedRepos.length >= 1;
  return out;
}
