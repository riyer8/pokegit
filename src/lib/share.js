/**
 * Shareable PokéGit profile summary (public GitHub data only).
 * Text card for v1 — no private tokens, emails, or keys.
 */

function insightText(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  return item.text || item.title || "";
}

function topInsights(payload) {
  const fromObs = (payload.observations || [])
    .filter((o) => o.kind !== "uncertain")
    .map((o) => o.title)
    .filter(Boolean);
  const fromSummary = [
    ...(payload.summary?.strengths || []),
    ...(payload.summary?.interesting || []),
  ]
    .map(insightText)
    .filter(Boolean);

  const merged = [...fromObs, ...fromSummary];
  const seen = new Set();
  const out = [];
  for (const line of merged) {
    const key = line.toLowerCase().slice(0, 48);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line.replace(/\s+/g, " ").trim());
    if (out.length >= 3) break;
  }
  return out;
}

function formatScores(scores = {}) {
  const rows = [
    ["Testing", scores.testing],
    ["Architecture", scores.architecture],
    ["Maintenance", scores.maintenance],
    ["Docs", scores.documentation],
  ];
  return rows
    .filter(([, v]) => v != null)
    .map(([label, v]) => `${label} ${Number(v).toFixed(1)}`)
    .join(" · ");
}

function repoHighlights(analyzedRepos = []) {
  return analyzedRepos.slice(0, 4).map((item) => {
    const { repo, pokemon } = item;
    const why = (pokemon.why || pokemon.personality || pokemon.blurb || "").replace(/\s+/g, " ").trim();
    const shortWhy = why.length > 90 ? `${why.slice(0, 87)}…` : why;
    return `${pokemon.emoji} ${pokemon.name} — ${repo.name}${shortWhy ? `\n   ${shortWhy}` : ""}`;
  });
}

/**
 * Build a polished plain-text share card.
 */
export function buildShareText(payload) {
  if (!payload?.user) return "PokéGit — no profile loaded.";
  if (payload.insufficient) {
    return [
      `PokéGit · @${payload.user.login}`,
      "",
      payload.insufficientReason || "Not enough public information to generate a meaningful profile.",
      "",
      "— analyzed with PokéGit (public GitHub signals only)",
    ].join("\n");
  }

  const login = payload.user.login;
  const glance = payload.glance || {};
  const archetype =
    glance.headline ||
    payload.summary?.glanceHeadline ||
    "Public GitHub engineer";
  const quote = (glance.oneLiner || payload.summary?.oneLiner || "").replace(/^["“]|["”]$/g, "");
  const scores = formatScores(payload.profileScores);
  const insights = topInsights(payload);
  const highlights = repoHighlights(payload.analyzedRepos || []);
  const profileUrl = payload.user.htmlUrl || `https://github.com/${login}`;

  const lines = [
    `PokéGit · @${login}`,
    `🧑‍💻 ${archetype}`,
    quote ? `“${quote}”` : null,
    "",
    scores ? `📊 ${scores}` : null,
    insights.length ? "" : null,
    insights.length ? "🔍 Strongest insights" : null,
    ...insights.map((i, n) => `${n + 1}. ${i}`),
    highlights.length ? "" : null,
    highlights.length ? "🐉 Repo highlights" : null,
    ...highlights,
    "",
    `🔗 ${profileUrl}`,
    "— PokéGit · playful reading of public GitHub signals (not an ability grade)",
  ];

  return lines.filter((x) => x !== null).join("\n");
}
