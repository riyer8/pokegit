/**
 * Recent public activity from GitHub events (PushEvent).
 * Note: GitHub often omits payload.size and payload.commits now — we count pushes directly.
 */

import { focusAreaLabel } from "./focus.js";

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Weight for one PushEvent. Uses size/commits when present; otherwise counts the push.
 */
export function pushEventWeight(ev) {
  if (ev?.type !== "PushEvent") return 0;
  const p = ev.payload || {};
  const size = Number(p.size);
  if (Number.isFinite(size) && size > 0) return size;
  const n = p.commits?.length;
  if (n > 0) return n;
  const before = p.before;
  const head = p.head;
  if (before && head && before !== head && !/^0+$/.test(String(before))) return 1;
  return 1;
}

/**
 * @param {Array} events - GitHub public events payload
 * @param {{ analyzedRepos?: Array, profileActivityScore?: number }} [opts]
 */
export function summarizePublicActivity(events = [], opts = {}) {
  const analyzed = opts.analyzedRepos || [];
  const pushes = [];

  for (const ev of events || []) {
    if (ev?.type !== "PushEvent") continue;
    const fullName = ev.repo?.name || "";
    const short = fullName.includes("/") ? fullName.split("/").pop() : fullName;
    const commits = pushEventWeight(ev);
    pushes.push({
      at: ev.created_at,
      repo: short,
      fullName,
      commits,
    });
  }

  const byRepo = {};
  let commitApprox = 0;
  const pushCount = pushes.length;
  for (const p of pushes) {
    commitApprox += p.commits;
    if (!p.repo) continue;
    byRepo[p.repo] = (byRepo[p.repo] || 0) + p.commits;
  }

  const reposTouched = Object.entries(byRepo)
    .sort((a, b) => b[1] - a[1])
    .map(([name, commits]) => ({ name, commits }));

  const pushByRepo = {};
  for (const p of pushes) {
    if (!p.repo) continue;
    pushByRepo[p.repo] = (pushByRepo[p.repo] || 0) + 1;
  }
  const reposPushed = Object.entries(pushByRepo)
    .sort((a, b) => b[1] - a[1])
    .map(([name, pushes]) => ({ name, pushes }));

  const lastAt = pushes[0]?.at || null;
  const daysSinceLast = lastAt != null ? daysSince(lastAt) : null;

  const byPush = [...analyzed].sort(
    (a, b) => new Date(b.repo.pushedAt) - new Date(a.repo.pushedAt)
  );
  const active30 = analyzed.filter((a) => daysSince(a.repo.pushedAt) < 30).length;
  const active90 = analyzed.filter((a) => daysSince(a.repo.pushedAt) < 90).length;
  const newestRepo = byPush[0]?.repo;
  const newestPushDays = newestRepo ? Math.round(daysSince(newestRepo.pushedAt)) : null;

  const score = opts.profileActivityScore;
  const activitySignal = Math.max(pushCount, commitApprox);
  let label = "steady";
  if (activitySignal >= 25 || (active30 >= 2 && activitySignal >= 8) || (score != null && score >= 8.5)) {
    label = "hot";
  } else if (activitySignal >= 8 || active30 >= 1 || (score != null && score >= 7)) {
    label = "active";
  } else if (
    (daysSinceLast != null && daysSinceLast > 120) ||
    (newestPushDays != null && newestPushDays > 270) ||
    (score != null && score <= 4)
  ) {
    label = "quiet";
  } else if (
    (newestPushDays != null && newestPushDays > 540) ||
    (analyzed.length > 0 && active90 === 0 && pushCount === 0)
  ) {
    label = "dormant";
  }

  const topRepos = reposPushed.length ? reposPushed : reposTouched.slice(0, 3);
  let sampleNote = null;
  if (pushCount > 0 && topRepos.length) {
    const repoBit = topRepos
      .slice(0, 3)
      .map((r) => `${r.name}${r.pushes ? ` (${r.pushes} push${r.pushes === 1 ? "" : "es"})` : r.commits ? ` (~${r.commits})` : ""}`)
      .join(", ");
    sampleNote = `${pushCount} public push${pushCount === 1 ? "" : "es"} across ${
      reposPushed.length || reposTouched.length
    } repo${(reposPushed.length || reposTouched.length) === 1 ? "" : "s"} recently (${repoBit}).`;
  } else if (newestRepo && newestPushDays != null) {
    sampleNote =
      newestPushDays < 14
        ? `${newestRepo.name} was pushed within the last two weeks.`
        : newestPushDays < 90
          ? `${newestRepo.name} last moved ~${newestPushDays}d ago.`
          : `Newest sample push is ~${newestPushDays}d old (${newestRepo.name}).`;
  }

  return {
    pushEvents: pushCount,
    pushCount,
    commitApprox,
    reposTouched,
    reposPushed,
    commitsByRepo: byRepo,
    daysSinceLastPushEvent: daysSinceLast != null ? Math.round(daysSinceLast) : null,
    active30,
    active90,
    newestRepoName: newestRepo?.name || null,
    newestPushDays,
    label,
    sampleNote,
  };
}

/**
 * Weekly public pushes + repo update dates (last N weeks).
 */
export function buildWeeklyPublicActivity(
  events = [],
  repos = [],
  weekCount = 12,
  now = Date.now()
) {
  const msWeek = 7 * 24 * 60 * 60 * 1000;
  const start = now - weekCount * msWeek;
  const weeks = Array.from({ length: weekCount }, (_, w) => ({
    weekStart: start + w * msWeek,
    pushes: 0,
    repoUpdates: 0,
  }));

  for (const ev of events || []) {
    if (ev?.type !== "PushEvent") continue;
    const t = new Date(ev.created_at).getTime();
    if (Number.isNaN(t) || t < start) continue;
    const idx = Math.min(weekCount - 1, Math.floor((t - start) / msWeek));
    weeks[idx].pushes += 1;
  }

  for (const r of repos || []) {
    const pushedAt = r.pushedAt || r.updatedAt;
    const t = new Date(pushedAt).getTime();
    if (Number.isNaN(t) || t < start) continue;
    const idx = Math.min(weekCount - 1, Math.floor((t - start) / msWeek));
    weeks[idx].repoUpdates += 1;
  }

  return weeks;
}

/** @deprecated use buildWeeklyPublicActivity */
export function buildWeeklyPublicCommits(events = [], weekCount = 12, now = Date.now()) {
  return buildWeeklyPublicActivity(events, [], weekCount, now).map((w) => ({
    weekStart: w.weekStart,
    commits: w.pushes,
  }));
}

/**
 * Merge public push data + contribution graph into a readable activity picture.
 */
export function buildActivityImpression(activity = {}, pulse = null, weekly = []) {
  const pushCount = activity.pushCount ?? activity.pushEvents ?? 0;
  const commitApprox = activity.commitApprox || 0;
  const yearCount = pulse?.yearCount ?? null;
  const includesPrivate = Boolean(pulse?.includesPrivate);
  const graphWeeks = pulse?.weeks || [];
  const graphRecent = graphWeeks.reduce((s, w) => s + (w.levelSum || 0), 0);
  const publicRecent = weekly.reduce((s, w) => s + (w.pushes || w.commits || 0), 0);
  const repoUpdatesRecent = weekly.reduce((s, w) => s + (w.repoUpdates || 0), 0);

  const publicQuiet =
    activity.label === "quiet" ||
    activity.label === "dormant" ||
    (pushCount === 0 && repoUpdatesRecent === 0 && (activity.newestPushDays == null || activity.newestPushDays > 90));

  const possiblyPrivate =
    includesPrivate ||
    (yearCount != null && yearCount >= 80 && publicQuiet) ||
    (graphRecent >= 18 && publicRecent < 3 && repoUpdatesRecent < 2);

  let impression;
  const topRepos = activity.reposPushed?.length
    ? activity.reposPushed
    : (activity.reposTouched || []).slice(0, 3);

  if (pushCount >= 15 && topRepos.length) {
    const where = topRepos
      .map((r) => `${r.name}${r.pushes ? ` (${r.pushes} pushes)` : r.commits ? ` (~${r.commits})` : ""}`)
      .join(", ");
    impression = `Shipping in public: ${pushCount} pushes recently, mostly ${where}.`;
  } else if (pushCount >= 5) {
    impression = `Active on public GitHub: ${pushCount} pushes in the events window.`;
  } else if (pushCount > 0) {
    impression = `${pushCount} public push${pushCount === 1 ? "" : "es"} in the recent sample.`;
  } else if (repoUpdatesRecent >= 2) {
    impression = `No push events in the sample, but ${repoUpdatesRecent} owned repos were updated in the last ~12 weeks.`;
  } else if (possiblyPrivate && yearCount != null) {
    impression = `Contribution graph shows ~${yearCount} in the last year${includesPrivate ? " including private" : ""}, but few public push events. Likely building privately or off-repo.`;
  } else if (publicQuiet) {
    impression =
      activity.newestRepoName && activity.newestPushDays != null
        ? `Public repos quiet. Last move ~${activity.newestPushDays}d ago on ${activity.newestRepoName}.`
        : "Public repos have been quiet lately.";
  } else if (activity.sampleNote) {
    impression = activity.sampleNote;
  } else {
    impression = "Steady but modest public activity.";
  }

  const maxPushes = Math.max(1, ...weekly.map((w) => w.pushes || w.commits || 0));
  const maxRepo = Math.max(1, ...weekly.map((w) => w.repoUpdates || 0));
  const maxGraph = Math.max(1, ...graphWeeks.map((w) => w.levelSum || 0), 1);

  return {
    impression,
    possiblyPrivate,
    includesPrivate,
    yearCount,
    pushCount,
    commitApprox,
    topRepos,
    weeklyPublic: weekly.map((w) => ({
      ...w,
      commits: w.pushes ?? w.commits ?? 0,
      height: Math.round(((w.pushes ?? w.commits ?? 0) / maxPushes) * 100),
    })),
    weeklyRepoUpdates: weekly.map((w) => ({
      ...w,
      height: Math.round(((w.repoUpdates || 0) / maxRepo) * 100),
    })),
    weeklyGraph: graphWeeks.map((w) => ({
      ...w,
      height: Math.round(((w.levelSum || 0) / maxGraph) * 100),
    })),
    recentActiveDays: pulse?.recentActiveDays ?? null,
    repoUpdatesRecent,
  };
}

/**
 * Rich activity dashboard: stats, where work lands, language footprint, read lines.
 */
export function buildActivityDashboard({
  activity = {},
  pulse = null,
  impression = null,
  weekly = [],
  analyzedRepos = [],
  allRepos = [],
  languageSummary = [],
  profileFocus = null,
}) {
  const pushCount = activity.pushCount ?? activity.pushEvents ?? 0;
  const yearCount = pulse?.yearCount ?? null;

  const stats = [
    pushCount > 0
      ? { label: "Public pushes", value: String(pushCount), tone: "good", hint: "~90d events sample" }
      : null,
    yearCount != null
      ? {
          label: "Contributions",
          value: `~${yearCount}`,
          tone: pulse?.includesPrivate ? "mid" : "good",
          hint: pulse?.includesPrivate ? "last year, incl. private" : "last year on profile",
        }
      : null,
    activity.active30 > 0
      ? { label: "Repos active (30d)", value: `${activity.active30}`, tone: "good", hint: "in analyzed set" }
      : null,
    activity.active90 > 0
      ? { label: "Repos active (90d)", value: `${activity.active90}`, tone: "mid", hint: "in analyzed set" }
      : null,
    pulse?.recentActiveDays > 0
      ? {
          label: "Graph days (14d)",
          value: String(pulse.recentActiveDays),
          tone: "good",
          hint: "contribution calendar",
        }
      : null,
    allRepos.length > 0
      ? { label: "Owned repos", value: String(allRepos.length), tone: "muted", hint: "public non-fork" }
      : null,
  ].filter(Boolean);

  const pushMap = Object.fromEntries(
    (activity.reposPushed || activity.reposTouched || []).map((r) => [r.name, r.pushes ?? r.commits ?? 0])
  );

  const repoPool = [...analyzedRepos]
    .sort((a, b) => new Date(b.repo.pushedAt) - new Date(a.repo.pushedAt))
    .slice(0, 6);

  const whereWorkLands = repoPool.map((item) => {
    const topFocus = Object.entries(item.focusScores || {})
      .sort((a, b) => b[1] - a[1])[0];
    return {
      name: item.repo.name,
      language: item.repo.language,
      stars: item.repo.stargazers || 0,
      pushedAt: item.repo.pushedAt,
      daysSince: Math.round(daysSince(item.repo.pushedAt)),
      pushes: pushMap[item.repo.name] || 0,
      focus: topFocus ? focusAreaLabel(topFocus[0]) : null,
      oneLiner: item.oneLiner || item.repo.description || "",
    };
  });

  const recentRepos = analyzedRepos.filter((a) => daysSince(a.repo.pushedAt) < 120);
  const olderRepos = analyzedRepos.filter((a) => daysSince(a.repo.pushedAt) >= 120);
  const recentFocus = aggregateFocusLean(recentRepos);
  const overallFocus = profileFocus?.top?.[0]?.label || aggregateFocusLean(analyzedRepos);

  const readLines = [];
  if (impression?.possiblyPrivate) {
    readLines.push({
      icon: "🌙",
      text: "Graph is busier than public push events. They may be cooking in private or on repos outside the sample.",
    });
  }
  if (pushCount >= 8 && whereWorkLands[0]) {
    readLines.push({
      icon: "🚀",
      text: `Most public energy lately: ${whereWorkLands
        .filter((r) => r.pushes > 0)
        .slice(0, 2)
        .map((r) => r.name)
        .join(" & ") || whereWorkLands[0].name}.`,
    });
  }
  if (recentFocus && olderRepos.length > 0 && recentFocus !== overallFocus) {
    readLines.push({
      icon: "🔀",
      text: `Recent work leans ${String(recentFocus).toLowerCase()}; older repos skew broader.`,
    });
  } else if (overallFocus) {
    readLines.push({
      icon: "🎯",
      text: `Overall public silhouette: ${String(overallFocus).toLowerCase()} builder.`,
    });
  }
  if (languageSummary[0]) {
    const langs = languageSummary
      .slice(0, 3)
      .map((l) => `${l.name} ${l.percent}%`)
      .join(", ");
    readLines.push({ icon: "🧩", text: `Language weight: ${langs}.` });
  }

  const languages = (languageSummary || []).slice(0, 5).map((l) => ({
    name: l.name,
    percent: l.percent,
    height: Math.round(l.percent),
  }));

  const charts = buildActivityCharts({ impression, pulse, weekly, activity, allRepos });

  return {
    stats: stats.slice(0, 5),
    whereWorkLands,
    readLines: readLines.slice(0, 4),
    languages,
    weekly,
    impression,
    charts,
  };
}

function formatWeekLabel(weekStart) {
  if (!weekStart) return "";
  const d = new Date(weekStart);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildBars(weeks, getValue) {
  const values = weeks.map((w, i) => getValue(w, i) || 0);
  const max = Math.max(1, ...values);
  return weeks.map((w, i) => {
    const value = values[i];
    return {
      weekStart: w.weekStart,
      label: formatWeekLabel(w.weekStart),
      value,
      height: value > 0 ? Math.max(10, Math.round((value / max) * 100)) : 3,
    };
  });
}

/**
 * Tabbed chart views with honest labels and per-view captions.
 */
export function buildActivityCharts({
  impression = null,
  pulse = null,
  weekly = [],
  activity = {},
  allRepos = [],
} = {}) {
  const graphWeeks = impression?.weeklyGraph || pulse?.weeks || [];
  const pushWeeks = impression?.weeklyPublic || weekly;
  const repoWeeks = impression?.weeklyRepoUpdates || weekly;
  const yearCount = pulse?.yearCount ?? impression?.yearCount ?? null;
  const includesPrivate = Boolean(pulse?.includesPrivate ?? impression?.includesPrivate);
  const pushCount = activity.pushCount ?? activity.pushEvents ?? impression?.pushCount ?? 0;
  const views = [];

  const graphBars = buildBars(graphWeeks, (w) => w.levelSum || 0);
  const graphRecent = graphBars.reduce((s, b) => s + b.value, 0);
  const hasGraphBars = graphBars.some((b) => b.value > 0);

  if (hasGraphBars || yearCount != null) {
    views.push({
      id: "contributions",
      label: "Contributions",
      shortLabel: "Graph",
      headline:
        yearCount != null
          ? `~${yearCount.toLocaleString()} in the last year`
          : `${graphRecent} intensity over 12 weeks`,
      subhead: includesPrivate ? "May include private work" : "GitHub contribution calendar",
      caption: hasGraphBars
        ? "Each bar is one week. Height sums daily contribution levels (0–4 per day) — not commit counts."
        : "Year total from the profile; week-by-week graph was not available on this page.",
      bars: graphBars,
      accent: "graph",
      empty: !hasGraphBars,
      emptyMessage:
        yearCount != null
          ? `~${yearCount.toLocaleString()} contributions in the last year, but no week-by-week bars were found.`
          : "Contribution calendar not found on this profile page.",
    });
  }

  const pushBars = buildBars(pushWeeks, (w) => w.pushes ?? w.commits ?? 0);
  const pushBarTotal = pushBars.reduce((s, b) => s + b.value, 0);
  if (pushBarTotal > 0 || pushCount > 0) {
    views.push({
      id: "pushes",
      label: "Public pushes",
      shortLabel: "Pushes",
      headline: `${pushCount || pushBarTotal} push event${(pushCount || pushBarTotal) === 1 ? "" : "s"}`,
      subhead: "Last ~90 days of public events",
      caption:
        "Each bar counts public push events (one per git push), not individual commits. GitHub may omit older events.",
      bars: pushBars,
      accent: "public",
      empty: pushBarTotal === 0,
      emptyMessage: `${pushCount} push event${pushCount === 1 ? "" : "s"} in the sample, but none in the last 12 weeks.`,
    });
  }

  const repoBars = buildBars(repoWeeks, (w) => w.repoUpdates || 0);
  const repoBarTotal = repoBars.reduce((s, b) => s + b.value, 0);
  if (repoBarTotal > 0 || allRepos.length > 0) {
    views.push({
      id: "repos",
      label: "Repo touches",
      shortLabel: "Repos",
      headline: `${repoBarTotal} repo${repoBarTotal === 1 ? "" : "s"} touched in window`,
      subhead: allRepos.length ? `${allRepos.length} public repos tracked` : "Owned public repos",
      caption:
        "Repos whose most recent push landed in each week. Shows where attention went — not commits per repo.",
      bars: repoBars,
      accent: "repo",
      empty: repoBarTotal === 0,
      emptyMessage: "No owned repos were pushed in the last 12 weeks.",
    });
  }

  const defaultId =
    views.find((v) => v.id === "contributions" && !v.empty)?.id ||
    views.find((v) => !v.empty)?.id ||
    views[0]?.id ||
    "contributions";

  return { defaultId, views };
}

function aggregateFocusLean(repos) {
  if (!repos.length) return null;
  const totals = {};
  for (const item of repos) {
    for (const [k, v] of Object.entries(item.focusScores || {})) {
      totals[k] = (totals[k] || 0) + v;
    }
  }
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  return top ? focusAreaLabel(top[0]) : null;
}

/** Short adjective for headlines / one-liners. */
export function activityAdjective(activity) {
  switch (activity?.label) {
    case "hot":
      return "Highly active";
    case "active":
      return "Active";
    case "quiet":
      return "Quietly shipping";
    case "dormant":
      return "Mostly quiet";
    default:
      return "Steady";
  }
}

/** Lowercase vibe fragment for sentence midpoints. */
export function activityVibe(activity) {
  switch (activity?.label) {
    case "hot":
      return "shipping often";
    case "active":
      return "recently active";
    case "quiet":
      return "quieter lately";
    case "dormant":
      return "dormant on public pushes";
    default:
      return "keeping a steady pace";
  }
}
