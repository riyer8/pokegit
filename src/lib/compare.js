/**
 * Descriptive comparison of two PokéGit profiles.
 * Never ranks "who is better" — only contrasts public signals.
 */

function scoreOf(payload, key) {
  const v = payload?.profileScores?.[key];
  return v == null ? null : Number(v);
}

function langNames(payload) {
  return (payload?.languageSummary || []).map((l) => l.name).filter(Boolean);
}

function testRate(payload) {
  const repos = payload?.analyzedRepos || [];
  if (!repos.length) return null;
  return repos.filter((a) => a.signals?.hasTests).length / repos.length;
}

function pokeMix(payload) {
  const counts = {};
  for (const a of payload?.analyzedRepos || []) {
    const n = a.pokemon?.name;
    if (!n) continue;
    counts[n] = (counts[n] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, n]) => ({ name, n }));
}

function dimDiff(a, b, key, label) {
  const sa = scoreOf(a, key);
  const sb = scoreOf(b, key);
  if (sa == null || sb == null) return null;
  const delta = Math.round((sa - sb) * 10) / 10;
  if (Math.abs(delta) < 1.2) return null;
  const higher = delta > 0 ? a.user.login : b.user.login;
  const lower = delta > 0 ? b.user.login : a.user.login;
  return {
    kind: "observed",
    title: `${label} diverges`,
    body: `@${higher} reads stronger on ${label.toLowerCase()} (${Math.max(sa, sb).toFixed(1)} vs ${Math.min(sa, sb).toFixed(1)}). That is a public-signal difference, not a talent ranking.`,
    evidence: [`@${a.user.login} ${label} ${sa.toFixed(1)}`, `@${b.user.login} ${label} ${sb.toFixed(1)}`],
  };
}

/**
 * @returns {{ left, right, differences: Array, similarities: Array, disclaimer: string }}
 */
export function compareProfiles(left, right) {
  const disclaimer =
    "Descriptive contrast of public GitHub signals only. Not a ranking of who is the better engineer.";

  if (!left?.user || !right?.user) {
    return { left, right, differences: [], similarities: [], disclaimer };
  }

  const differences = [];
  const similarities = [];

  for (const [key, label] of [
    ["testing", "Testing"],
    ["maintenance", "Maintenance"],
    ["architecture", "Architecture"],
    ["documentation", "Documentation"],
    ["activity", "Activity"],
  ]) {
    const d = dimDiff(left, right, key, label);
    if (d) differences.push(d);
  }

  const la = langNames(left);
  const lb = langNames(right);
  const shared = la.filter((x) => lb.includes(x));
  const onlyA = la.filter((x) => !lb.includes(x));
  const onlyB = lb.filter((x) => !la.includes(x));

  if (shared.length >= 1) {
    similarities.push({
      kind: "observed",
      title: "Shared language footprint",
      body: `Both profiles surface ${shared.slice(0, 3).join(", ")} in the analyzed sample.`,
      evidence: shared.slice(0, 3),
    });
  }
  if (onlyA.length || onlyB.length) {
    differences.push({
      kind: "observed",
      title: "Different stack emphasis",
      body: [
        onlyA.length ? `@${left.user.login} leans ${onlyA.slice(0, 2).join(" / ")}` : null,
        onlyB.length ? `@${right.user.login} leans ${onlyB.slice(0, 2).join(" / ")}` : null,
      ]
        .filter(Boolean)
        .join(". "),
      evidence: [
        `@${left.user.login}: ${la.slice(0, 3).join(", ") || "mixed"}`,
        `@${right.user.login}: ${lb.slice(0, 3).join(", ") || "mixed"}`,
      ],
    });
  }

  const ta = testRate(left);
  const tb = testRate(right);
  if (ta != null && tb != null && Math.abs(ta - tb) >= 0.35) {
    const higher = ta > tb ? left : right;
    const lower = ta > tb ? right : left;
    const hi = ta > tb ? ta : tb;
    const lo = ta > tb ? tb : ta;
    differences.push({
      kind: "observed",
      title: "Testing habits look different",
      body: `@${higher.user.login} shows automated tests in roughly ${Math.round(hi * 100)}% of analyzed repos vs ~${Math.round(lo * 100)}% for @${lower.user.login}.`,
      evidence: [
        `@${left.user.login}: ${Math.round(ta * 100)}% with tests`,
        `@${right.user.login}: ${Math.round(tb * 100)}% with tests`,
      ],
    });
  } else if (ta != null && tb != null && Math.abs(ta - tb) < 0.2 && ta >= 0.5) {
    similarities.push({
      kind: "inferred",
      title: "Similar testing cadence",
      body: `Both profiles show automated tests in a sizable share of the sample (~${Math.round(((ta + tb) / 2) * 100)}%).`,
      evidence: [`@${left.user.login} ${Math.round(ta * 100)}%`, `@${right.user.login} ${Math.round(tb * 100)}%`],
    });
  }

  const pa = pokeMix(left);
  const pb = pokeMix(right);
  if (pa[0] && pb[0] && pa[0].name !== pb[0].name) {
    differences.push({
      kind: "inferred",
      title: "Repository personalities diverge",
      body: `@${left.user.login}'s party leans ${pa[0].name}; @${right.user.login}'s leans ${pb[0].name}. Different public project shapes, not a contest.`,
      evidence: [
        `@${left.user.login}: ${pa.map((p) => `${p.name}×${p.n}`).join(", ")}`,
        `@${right.user.login}: ${pb.map((p) => `${p.name}×${p.n}`).join(", ")}`,
      ],
    });
  } else if (pa[0] && pb[0] && pa[0].name === pb[0].name) {
    similarities.push({
      kind: "inferred",
      title: "Similar Pokémon silhouette",
      body: `Both samples lean ${pa[0].name}. Overlapping repository personality in the public set.`,
      evidence: [`Dominant: ${pa[0].name}`],
    });
  }

  const ha = left.glance?.headline || left.summary?.glanceHeadline;
  const hb = right.glance?.headline || right.summary?.glanceHeadline;
  if (ha && hb && ha.toLowerCase() !== hb.toLowerCase()) {
    differences.push({
      kind: "inferred",
      title: "Different engineering silhouettes",
      body: `@${left.user.login} reads as “${ha}.” @${right.user.login} reads as “${hb}.”`,
      evidence: [`@${left.user.login}: ${ha}`, `@${right.user.login}: ${hb}`],
    });
  }

  // Cap — prefer differences that are meaningful
  return {
    left,
    right,
    differences: differences.slice(0, 6),
    similarities: similarities.slice(0, 4),
    disclaimer,
  };
}
