/**
 * Crude Day-1 scores from public repo signals. Experimental only.
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
  const size = repo.size || 0;
  const root = (signals.rootFiles || []).map((n) => n.toLowerCase());
  const hay = `${(repo.topics || []).join(" ")} ${repo.description || ""} ${root.join(" ")}`.toLowerCase();

  // 🏗 Architecture: structure / organization / framework signals
  let architecture = 4;
  if (repo.language) architecture += 0.8;
  if (root.some((n) => ["src", "lib", "app", "pkg", "packages", "internal", "cmd"].includes(n))) {
    architecture += 1.5;
  }
  if (root.some((n) => n === "package.json" || n === "go.mod" || n === "cargo.toml" || n === "pyproject.toml")) {
    architecture += 0.8;
  }
  if ((repo.topics || []).length >= 2) architecture += 0.6;
  if (signals.hasLicenseFile || repo.license) architecture += 0.5;
  if (/monorepo|microservice|design-system|sdk|framework/.test(hay)) architecture += 0.8;
  if (repo.archived) architecture -= 1;

  // 🧪 Testing
  let testing = 2.5;
  if (signals.hasTests) testing += 4.5;
  if (signals.hasCi) testing += 2.5;
  if (signals.hasTests && signals.hasCi) testing += 0.5;

  // 🔄 Maintenance (finished old projects aren't automatically "bad" — just quieter)
  let maintenance = 4;
  if (days < 30) maintenance += 4;
  else if (days < 90) maintenance += 3;
  else if (days < 180) maintenance += 2;
  else if (days < 365) maintenance += 0.5;
  else if (days < 730) maintenance -= 0.5;
  else maintenance -= 1.5;
  if (signals.recentRelease && daysSince(signals.recentRelease.publishedAt) < 365) maintenance += 1.2;
  if (repo.archived) maintenance = Math.min(maintenance, 3.5);
  // Mature + stable (old but once solid) softens the penalty
  if (ageYears >= 3 && days > 365 && days < 900 && (repo.stargazers || 0) >= 50) {
    maintenance = Math.max(maintenance, 5);
  }

  // 📚 Documentation
  let documentation = 2;
  if (signals.hasReadme) documentation += 3.5;
  if (signals.hasDocs) documentation += 2.5;
  if (signals.hasContributing) documentation += 1.5;
  if (repo.description && repo.description.length > 20) documentation += 0.8;
  if ((repo.topics || []).length >= 3) documentation += 0.5;

  // 🛠 Complexity
  let complexity = 3;
  complexity += Math.min(3.5, Math.log10(size + 10));
  if ((repo.topics || []).length >= 4) complexity += 0.6;
  if (/ml|compiler|distributed|kubernetes|database|protocol|crypto|engine/.test(hay)) complexity += 1.2;
  if (root.filter((n) => ["src", "lib", "pkg", "internal", "cmd", "apps", "services"].includes(n)).length >= 2) {
    complexity += 0.8;
  }
  if (size < 50) complexity = Math.min(complexity, 4);

  // 🚀 Activity (recent development)
  let activity = 2;
  if (days < 14) activity += 6;
  else if (days < 45) activity += 5;
  else if (days < 120) activity += 3.5;
  else if (days < 270) activity += 2;
  else if (days < 540) activity += 0.5;
  else activity -= 1;
  if (signals.recentRelease && daysSince(signals.recentRelease.publishedAt) < 180) activity += 1;
  if (repo.archived) activity = Math.min(activity, 2);

  return {
    architecture: clamp(architecture),
    testing: clamp(testing),
    maintenance: clamp(maintenance),
    documentation: clamp(documentation),
    complexity: clamp(complexity),
    activity: clamp(activity),
    // aliases used by older pokemon heuristics
    codeQuality: clamp(architecture),
  };
}

export function aggregateProfileScores(analyzedRepos) {
  const dims = ["architecture", "testing", "maintenance", "documentation", "complexity", "activity"];
  if (!analyzedRepos.length) {
    return Object.fromEntries([...dims.map((d) => [d, null]), ["enoughData", false]]);
  }

  const totals = Object.fromEntries(dims.map((d) => [d, { w: 0, s: 0 }]));

  for (const item of analyzedRepos) {
    const weight =
      Math.log10((item.repo.stargazers || 0) + 10) *
      (item.repo.archived ? 0.4 : 1) *
      (daysSince(item.repo.pushedAt) < 365 ? 1.2 : 0.85);
    for (const d of dims) {
      totals[d].s += (item.scores[d] || 0) * weight;
      totals[d].w += weight;
    }
  }

  const out = {};
  for (const d of dims) {
    out[d] = totals[d].w ? clamp(totals[d].s / totals[d].w) : null;
  }
  out.enoughData = true;
  out.codeQuality = out.architecture;
  return out;
}

export const SCORE_DISCLAIMER =
  "Experimental score based on publicly observable repository signals. Not an objective assessment of engineering ability.";
